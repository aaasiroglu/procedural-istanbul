"""Static user-equilibrium assignment (Frank-Wolfe, BPR link costs) that also returns the assignment matrix P.

P[e, w] is the share of OD pair w's trips that use link e, so the link flows are P @ x for an OD vector x. Frank-Wolfe
moves the flows by a step a towards an all-or-nothing (AON) loading each iteration; carrying P along with the same
step keeps P @ x equal to the flows at every iteration, which is what the bilevel estimator needs.

OD pairs are ordered origin-major: w = i * Z + j for zones i, j (diagonal pairs carry no trips and stay empty).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra


@dataclass
class Network:
    n_nodes: int
    tail: np.ndarray       # link start node
    head: np.ndarray       # link end node
    t0: np.ndarray         # free-flow travel time (any unit, minutes by convention)
    capacity: np.ndarray   # veh/h
    zones: np.ndarray      # node index of each zone centroid (where its trips start)
    alpha: float | np.ndarray = 0.15  # BPR: t = t0 * (1 + alpha * (v/c)^beta), one value or one per link
    beta: float | np.ndarray = 4.0
    # node where each zone's trips end, if not the centroid: a separate sink with only incoming connectors keeps
    # routes from cutting through a zone centroid (in at one connector, out at another)
    sinks: np.ndarray | None = None

    def __post_init__(self):
        self.tail, self.head = np.asarray(self.tail, int), np.asarray(self.head, int)
        self.t0, self.capacity = np.asarray(self.t0, float), np.asarray(self.capacity, float)
        self.zones = np.asarray(self.zones, int)
        self.sinks = self.zones if self.sinks is None else np.asarray(self.sinks, int)
        n = len(self.tail)
        self.alpha = np.broadcast_to(np.asarray(self.alpha, float), (n,)).copy()
        self.beta = np.broadcast_to(np.asarray(self.beta, float), (n,)).copy()
        pairs = list(zip(self.tail, self.head))
        if len(set(pairs)) != len(pairs):
            raise ValueError("parallel links between the same two nodes are not supported; split one with a node")
        # link index + 1 by (tail, head), sparse: 0 means no link
        self.link_matrix = csr_matrix((np.arange(1, len(pairs) + 1), (self.tail, self.head)), shape=(self.n_nodes, self.n_nodes))

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
    link_index = net.link_matrix
    rows, cols = [], []
    for i in range(Z):
        p = pred[i]
        # the link into every node of origin i's shortest-path tree, then each destination's path is its chain
        into = np.full(net.n_nodes, -1)
        reached = p >= 0
        if reached.any():  # (a gateway that only lets traffic out reaches nothing)
            into[reached] = np.asarray(link_index[p[reached], np.flatnonzero(reached)]).ravel() - 1
        for j in range(Z):
            if i == j:
                continue
            node, target = net.sinks[j], net.zones[i]
            w = i * Z + j
            if p[node] < 0:
                if demand[w] > 0:
                    raise ValueError(f"zone {j} cannot be reached from zone {i}, yet has trips from it")
                continue  # (e.g. a one-way gateway that only lets traffic in)
            while node != target:
                rows.append(into[node]); cols.append(w)
                node = p[node]
    incidence = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(net.n_links, Z * Z))
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
