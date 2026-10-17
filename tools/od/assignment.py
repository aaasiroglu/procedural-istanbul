"""Static user-equilibrium assignment (Frank-Wolfe, BPR link costs) that also returns the assignment matrix P.

P[e, w] is the share of OD pair w's trips that use link e, so the link flows are P @ x for an OD vector x. Frank-Wolfe
moves the flows by a step a towards an all-or-nothing (AON) loading each iteration; carrying P along with the same
step keeps P @ x equal to the flows at every iteration, which is what the bilevel estimator needs.

OD pairs are ordered origin-major: w = i * Z + j for zones i, j (diagonal pairs carry no trips and stay empty).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import csr_matrix, lil_matrix
from scipy.sparse.csgraph import dijkstra


@dataclass
class Network:
    n_nodes: int
    tail: np.ndarray       # link start node
    head: np.ndarray       # link end node
    t0: np.ndarray         # free-flow travel time (any unit, minutes by convention)
    capacity: np.ndarray   # veh/h
    zones: np.ndarray      # node index of each zone centroid
    alpha: float = 0.15    # BPR: t = t0 * (1 + alpha * (v/c)^beta)
    beta: float = 4.0

    def __post_init__(self):
        self.tail, self.head = np.asarray(self.tail, int), np.asarray(self.head, int)
        self.t0, self.capacity = np.asarray(self.t0, float), np.asarray(self.capacity, float)
        self.zones = np.asarray(self.zones, int)
        pairs = list(zip(self.tail, self.head))
        if len(set(pairs)) != len(pairs):
            raise ValueError("parallel links between the same two nodes are not supported; split one with a node")
        self.link_of = {p: e for e, p in enumerate(pairs)}

    @property
    def n_links(self) -> int:
        return len(self.tail)

    @property
    def n_od(self) -> int:
        return len(self.zones) ** 2

    def cost(self, flow: np.ndarray) -> np.ndarray:
        return self.t0 * (1 + self.alpha * (flow / self.capacity) ** self.beta)

    def beckmann(self, flow: np.ndarray) -> float:
        # the integral of the BPR cost from 0 to the flow, summed over links: UE minimises it
        c = self.capacity
        return float(np.sum(self.t0 * (flow + self.alpha * c / (self.beta + 1) * (flow / c) ** (self.beta + 1))))


def all_or_nothing(net: Network, cost: np.ndarray, demand: np.ndarray):
    """Every OD pair on its shortest path: returns (link flows, incidence matrix links x OD pairs)."""
    graph = csr_matrix((cost, (net.tail, net.head)), shape=(net.n_nodes, net.n_nodes))
    _, pred = dijkstra(graph, directed=True, indices=net.zones, return_predecessors=True)
    Z = len(net.zones)
    incidence = lil_matrix((net.n_links, Z * Z))
    for i in range(Z):
        for j in range(Z):
            if i == j:
                continue
            node, target = net.zones[j], net.zones[i]
            if pred[i, node] < 0:
                raise ValueError(f"zone {j} cannot be reached from zone {i}")
            while node != target:
                prev = pred[i, node]
                incidence[net.link_of[(prev, node)], i * Z + j] = 1.0
                node = prev
    incidence = incidence.tocsr()
    return incidence @ demand, incidence


def assign(net: Network, demand: np.ndarray, max_iter: int = 200, gap: float = 1e-4):
    """User equilibrium for an OD vector. Returns (link flows, P, relative gap reached)."""
    demand = np.asarray(demand, float)
    flow, P = all_or_nothing(net, net.t0, demand)
    rel_gap = np.inf
    for _ in range(max_iter):
        cost = net.cost(flow)
        target, P_aon = all_or_nothing(net, cost, demand)
        total = float(cost @ flow)
        rel_gap = (total - float(cost @ target)) / total if total > 0 else 0.0
        if rel_gap < gap:
            break
        direction = target - flow
        # exact line search: d/da Beckmann(flow + a d) = cost(flow + a d) . d is increasing in a; bisect for its root
        lo, hi = 0.0, 1.0
        if net.cost(flow + direction) @ direction <= 0:
            lo = 1.0
        else:
            for _ in range(40):
                mid = (lo + hi) / 2
                if net.cost(flow + mid * direction) @ direction > 0:
                    hi = mid
                else:
                    lo = mid
        step = lo
        flow = flow + step * direction
        P = P + step * (P_aon - P)
    return flow, P.tocsr(), rel_gap
