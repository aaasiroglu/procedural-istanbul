"""Origin-destination matrix estimation from link observations (inverse OD), with uncertainty and honest validation.

The problem. İBB's live feed gives each road segment a speed and a congestion class, not a vehicle count; real
counts are few (e.g. KGM's bridge crossings). A simulator needs the OD matrix x (trips from zone i to zone j), and
the link flows it produces are P @ x, P being the assignment matrix (tools/od/assignment.py). There are far more OD
pairs than observed links, so the data alone cannot pin x down: it is an ill-posed inverse problem.

The estimator (MAP, convex for a fixed P):

    min_x  sum_counts ((Px)_e - y_e)^2 / s_e^2                exact observations (counts)
         + sum_lower  max(0, y_e - (Px)_e)^2 / s_e^2          "at least y_e": a queue, read from a low speed
         + sum_upper  max(0, (Px)_e - y_e)^2 / s_e^2          "at most y_e": free flow, read from a high speed
         + lam * KL(x || x0)                                   stay close to the prior x0 where the data is silent
    s.t. x >= 0

Speed as censored information. Under a triangular fundamental diagram a link at free-flow speed may carry any flow
from 0 to its capacity: its speed says only "below capacity" (an upper bound). Only a speed below free flow, on the
congested branch, gives a flow, and since a queue means demand exceeded what got through, that flow is a lower bound
on the demand loaded onto the link. Treating speeds as these one-sided bounds, instead of turning them into fake
counts, is what keeps the estimate from inventing precision the data does not have.

Uncertainty. The inverse Hessian at the optimum (Laplace approximation) gives every OD pair a standard error; its
ratio to the prior-only error says how much of that pair's value comes from data rather than from the prior
(`data_share`). Pairs with a data share near 0 are unidentified by the observations, and are flagged as such.

Validation. GEH on the counts the estimate was fitted to proves nothing. `cross_validate` refits with each fold of
counts held out and scores the GEH on the held-out counts only; `select_lambda` picks lam by that score.

Bilevel. P depends on x through congestion (route choice). `estimate_bilevel` alternates assignment and estimation
until the OD vector settles (the iterative scheme of Spiess 1990 / Yang et al. 1992).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from scipy.sparse import csr_matrix, diags

EPS = 1e-9


# ---------------------------------------------------------------- fundamental diagram: speed -> observation
@dataclass
class TriangularFD:
    """Per-lane triangular fundamental diagram (Newell / Daganzo): free-flow speed vf (km/h), capacity
    (veh/h/lane), jam density kj (veh/km/lane). The congested branch is q = w (kj - k), w the backward wave speed."""
    vf: float
    capacity: float = 1900.0
    kj: float = 140.0
    lanes: float = 1.0
    rel_sd: float = 0.15   # relative uncertainty of capacity and jam density, propagated into the flow

    @property
    def w(self) -> float:
        return self.capacity / (self.kj - self.capacity / self.vf)

    def congested_flow(self, v: float, capacity: float | None = None, kj: float | None = None) -> float:
        # on the congested branch, k = q / v and q = w (kj - k) give q = w kj v / (v + w)
        c, k = capacity or self.capacity, kj or self.kj
        w = c / (k - c / self.vf)
        return min(c, w * k * v / (v + w)) * self.lanes

    def observe(self, link: int, speed: float, free_ratio: float = 0.85) -> "Observation":
        """What a speed says about a link's flow (veh/h, all lanes)."""
        cap = self.capacity * self.lanes
        if speed >= free_ratio * self.vf:
            return Observation(link, cap, self.rel_sd * cap, "upper", "speed")
        q = self.congested_flow(speed)
        # spread of q over the capacity and jam density uncertainty (central differences, independent errors)
        d = self.rel_sd
        dq_c = (self.congested_flow(speed, capacity=self.capacity * (1 + d)) - self.congested_flow(speed, capacity=self.capacity * (1 - d))) / 2
        dq_k = (self.congested_flow(speed, kj=self.kj * (1 + d)) - self.congested_flow(speed, kj=self.kj * (1 - d))) / 2
        return Observation(link, q, max(np.hypot(dq_c, dq_k), 0.05 * q, 1.0), "lower", "speed")


@dataclass
class Observation:
    link: int
    value: float          # veh/h
    sd: float             # veh/h
    kind: str = "count"   # count | lower | upper
    source: str = ""      # free text: "KGM bridge", "speed", ...


# ---------------------------------------------------------------- statistics
def geh(modelled, observed):
    """GEH = sqrt(2 (M - C)^2 / (M + C)), hourly flows. GEH < 5 on 85 % of links is the usual calibration target."""
    m, c = np.asarray(modelled, float), np.asarray(observed, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        g = np.sqrt(2 * (m - c) ** 2 / (m + c))
    return np.where(m + c > 0, g, 0.0)


def geh_summary(modelled, observed) -> dict:
    g = geh(modelled, observed)
    return {"n": int(g.size), "under5_pct": float(np.mean(g < 5) * 100) if g.size else float("nan"),
            "mean": float(g.mean()) if g.size else float("nan"), "max": float(g.max()) if g.size else float("nan"),
            "passes": bool(g.size and np.mean(g < 5) >= 0.85)}


# ---------------------------------------------------------------- estimator
@dataclass
class Estimate:
    x: np.ndarray                 # OD vector, trips/h
    se: np.ndarray | None         # standard error per OD pair (Laplace), None if not computed
    data_share: np.ndarray | None  # 0: value comes from the prior alone .. 1: from the data alone
    flows: np.ndarray             # P @ x
    fit: dict                     # in-sample GEH on counts (a fit diagnostic, not validation)
    bound_violations: int         # one-sided observations not met by more than 2 sd
    converged: bool
    lam: object                   # the prior weight(s) used
    info: dict = field(default_factory=dict)


def _rows(obs: list[Observation], kind: str):
    sel = [o for o in obs if o.kind == kind]
    return (np.array([o.link for o in sel], int), np.array([o.value for o in sel], float),
            np.array([o.sd for o in sel], float))


def prior_weights(x0, cv: float) -> np.ndarray:
    """Per-pair KL weights giving each OD pair a prior standard deviation of cv times its prior value.

    A single lam gives pair w a prior variance of 2 x0_w / lam, Poisson-like: a pair of 10 trips would be held to
    about +-4.5 whatever lam reasonably is, far tighter than a made-up gravity model deserves. lam_w = 2 / (cv^2 x0_w)
    makes the prior's uncertainty relative instead (cv = 1: +-100 %)."""
    x0 = np.asarray(x0, float)
    return np.where(x0 > 0, 2 / (cv ** 2 * np.where(x0 > 0, x0, 1)), 0.0)


def estimate(P, x0, obs: list[Observation], lam=1.0, uncertainty: bool = True, max_active: int = 4000) -> Estimate:
    """MAP OD estimate for a fixed assignment matrix P (links x OD pairs). x0 > 0 where trips are possible;
    pairs with x0 == 0 (e.g. the diagonal) stay at 0. lam: one prior weight, or one per OD pair (prior_weights)."""
    P = csr_matrix(P)
    x0 = np.asarray(x0, float)
    free = x0 > 0
    Pf = P[:, free]
    p0 = x0[free]
    lam_all = lam
    lam = np.asarray(lam, float)[free] if np.ndim(lam) else float(lam)
    groups = {k: _rows(obs, k) for k in ("count", "lower", "upper")}
    sub = {k: (Pf[l], y, 1 / s ** 2) for k, (l, y, s) in groups.items() if len(l)}

    def residuals(z):
        out = {}
        for k, (A, y, w) in sub.items():
            r = A @ z - y
            if k == "lower":
                r = np.minimum(r, 0)
            elif k == "upper":
                r = np.maximum(r, 0)
            out[k] = (A, r, w)
        return out

    # Solved for u = log(z / x0): positivity comes free and the problem stays well conditioned when prior values
    # span orders of magnitude (with relative prior weights the KL term becomes (2/cv^2)(e^u u - e^u + 1), the same
    # for every pair, where in z its curvature lam / z would range over twelve orders of magnitude).
    def objective(u):
        z = p0 * np.exp(u)
        f = np.sum(lam * (z * u - z + p0))
        g = lam * u
        for A, r, w in residuals(z).values():
            f += np.sum(w * r ** 2)
            g += 2 * (A.T @ (w * r))
        return f, g * z

    # start from the prior (u = 0): where the answer stays for pairs no observation touches
    res = minimize(objective, np.zeros(len(p0)), jac=True, method="L-BFGS-B", bounds=[(-30, 30)] * len(p0),
                   options={"maxiter": 5000, "maxfun": 20000, "ftol": 1e-13, "gtol": 1e-9})
    z = p0 * np.exp(res.x)
    x = np.zeros_like(x0)
    x[free] = z
    flows = P @ x

    se = share = B = None
    if uncertainty:
        # Hessian of the objective: D + B'B, D = lam / z from the KL term and B = sqrt(2 W) A over the active rows
        # (counts always, bounds where binding). The objective is -2 log posterior, so the covariance is 2 H^-1.
        # Only its diagonal is needed, and there are far fewer active rows m than OD pairs n, so by Woodbury
        #   H^-1 = D^-1 - D^-1 B' (I + B D^-1 B')^-1 B D^-1
        # costs an m x m solve instead of inverting n x n.
        d = lam / z
        blocks = []
        for k, (A, r, w) in residuals(z).items():
            active = np.ones(len(r), bool) if k == "count" else r != 0
            if active.any():
                blocks.append(diags(np.sqrt(2 * w[active])) @ A[active])
        if blocks:
            from scipy.sparse import vstack
            B = vstack(blocks).toarray() if sum(b.shape[0] for b in blocks) <= max_active else None  # (beyond that, skipped)
        else:
            B = np.zeros((0, len(z)))
        if B is not None:
            BD = B / d
            M = np.eye(B.shape[0]) + BD @ B.T
            var_post = np.clip(2 * (1 / d - np.sum(BD * np.linalg.solve(M, BD), axis=0)), 0, None)
    if B is not None:
        var_prior = 2 * z / lam
        se = np.zeros_like(x0)
        share = np.zeros_like(x0)
        se[free] = np.sqrt(var_post)
        share[free] = np.clip(1 - var_post / var_prior, 0, 1)

    cl, cy, _ = groups["count"]
    violations = 0
    for k, sign in (("lower", 1), ("upper", -1)):
        l, y, s = groups[k]
        if len(l):
            violations += int(np.sum(sign * (y - flows[l]) > 2 * s))
    return Estimate(x, se, share, flows, geh_summary(flows[cl], cy), violations, bool(res.success), lam_all,
                    {"iterations": int(res.nit), "message": str(res.message), "objective": float(res.fun)})


def cross_validate(P, x0, obs: list[Observation], lam: float, folds: int = 5, seed: int = 0) -> dict:
    """GEH on held-out counts: each fold of counts is left out, the rest (and every speed bound) fitted."""
    counts = [i for i, o in enumerate(obs) if o.kind == "count"]
    if len(counts) < 2:
        return {"n": 0, "under5_pct": float("nan"), "mean": float("nan"), "max": float("nan"), "passes": False}
    rng = np.random.default_rng(seed)
    order = rng.permutation(counts)
    held_m, held_c = [], []
    for f in range(min(folds, len(order))):
        out = set(order[f::folds].tolist())
        fit = estimate(P, x0, [o for i, o in enumerate(obs) if i not in out], lam, uncertainty=False)
        for i in out:
            held_m.append(fit.flows[obs[i].link])
            held_c.append(obs[i].value)
    return geh_summary(held_m, held_c)


def select_lambda(P, x0, obs: list[Observation], grid=(0.01, 0.03, 0.1, 0.3, 1, 3, 10), folds: int = 5) -> tuple[float, list]:
    """The prior weight with the best held-out GEH (mean GEH, ties to the larger, more cautious lam)."""
    scores = [(lam, cross_validate(P, x0, obs, lam, folds)) for lam in grid]
    best = min(scores, key=lambda s: (s[1]["mean"], -s[0]))
    return best[0], scores


def estimate_bilevel(net, x0, obs: list[Observation], lam: float = 1.0, iters: int = 30, tol: float = 1e-3,
                     assign_iter: int = 200, assign_gap: float = 1e-4, log=None):
    """Alternate UE assignment (route choice under the current OD) and estimation until the OD vector settles.
    The plain alternation oscillates (more demand -> other routes -> other fit); the route choice is therefore
    averaged over the rounds (method of successive averages), which damps it to a fixed point."""
    from assignment import assign
    x = np.asarray(x0, float)
    P_avg, history = None, []
    for k in range(iters):
        _, P, gap = assign(net, x, max_iter=assign_iter, gap=assign_gap)
        P_avg = P if P_avg is None else P_avg + (P - P_avg) / (k + 1)
        est = estimate(P_avg, x0, obs, lam, uncertainty=False)
        change = float(np.abs(est.x - x).sum() / max(x.sum(), EPS))
        history.append({"iteration": k, "assignment_gap": gap, "od_change": change, "fit": est.fit,
                        "bound_violations": est.bound_violations})
        if log:
            log(history[-1])
        x = est.x
        if change < tol:
            break
    final = estimate(P_avg, x0, obs, lam)
    final.info["bilevel"] = history
    final.info["P"] = P_avg
    return final
