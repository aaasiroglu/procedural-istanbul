"""Inverse OD on a synthetic city whose true OD matrix is known: does the estimator recover it, and does it say
honestly what it does not know?   uv run python tools/od/test_odme.py"""

import numpy as np

from assignment import Network, assign
from odme import Observation, TriangularFD, cross_validate, estimate, estimate_bilevel, geh, observed, prior_weights, select_lambda

rng = np.random.default_rng(7)
passed = 0


def ok(name, cond, detail=""):
    global passed
    if not cond:
        raise AssertionError(f"{name} {detail}")
    passed += 1
    print(f"ok   {name}{'  ' + detail if detail else ''}")


# ---------------------------------------------------------------- a 6 x 6 grid with two arterials
N = 6
tail, head, t0, cap = [], [], [], []
for r in range(N):
    for c in range(N):
        a = r * N + c
        for dr, dc in ((0, 1), (1, 0)):
            if r + dr < N and c + dc < N:
                b = (r + dr) * N + c + dc
                arterial = (dr == 0 and r == 2) or (dc == 0 and c == 3)
                for u, v in ((a, b), (b, a)):
                    tail.append(u); head.append(v)
                    t0.append(0.8 if arterial else 1.2)
                    cap.append(3600.0 if arterial else 1200.0)
zones = [0, 3, 5, 12, 17, 21, 30, 33, 35, 14]
net = Network(N * N, tail, head, t0, cap, zones)
Z = len(zones)

x_true = rng.lognormal(np.log(330), 0.6, Z * Z)
x_true[np.arange(Z) * (Z + 1)] = 0
flow_true, P_true, gap = assign(net, x_true)

ok("assignment converges", gap < 1e-3, f"relative gap {gap:.1e}")
ok("P @ x reproduces the link flows", np.allclose(P_true @ x_true, flow_true, rtol=1e-6))
inflow, outflow = np.bincount(net.head, flow_true, N * N), np.bincount(net.tail, flow_true, N * N)
through = np.setdiff1d(np.arange(N * N), zones)
ok("flow is conserved at every non-zone node", np.allclose(inflow[through], outflow[through], atol=1e-6))
ok("some links are congested", np.mean(flow_true > 0.9 * net.capacity) > 0.03, f"{np.mean(flow_true > 0.9 * net.capacity):.0%} over 0.9 v/c")

# ---------------------------------------------------------------- the fundamental diagram reads speeds as bounds
fd = TriangularFD(vf=50, capacity=1800)
free = fd.observe(0, 49)
q20, q35 = fd.observe(0, 20), fd.observe(0, 35)
ok("free-flow speed only bounds the flow from above", free.kind == "upper" and free.value == 1800)
ok("a congested speed gives a lower bound below capacity", q20.kind == "lower" and 0 < q20.value < 1800)
ok("on the congested branch flow rises with speed", q20.value < q35.value)

# ---------------------------------------------------------------- observations: a few counts, speeds elsewhere
counted = rng.choice(net.n_links, size=int(0.3 * net.n_links), replace=False)
obs = []
for e in counted:
    sd = 0.05 * flow_true[e] + 10
    obs.append(Observation(int(e), max(0.0, flow_true[e] + rng.normal(0, sd)), sd, "count", "synthetic loop"))
for e in np.setdiff1d(np.arange(net.n_links), counted):
    link_fd = TriangularFD(vf=50, capacity=net.capacity[e])
    if flow_true[e] > 0.9 * net.capacity[e]:
        q = 0.9 * net.capacity[e]  # the queue lets through less than the demand: the speed of that throughput
        speed = q * link_fd.w / (link_fd.w * link_fd.kj - q)
    else:
        speed = link_fd.vf
    obs.append(link_fd.observe(int(e), speed))

x0 = x_true * rng.lognormal(0, 0.5, Z * Z) * 0.8  # a biased, noisy prior (a gravity model or an old survey)
x0[np.arange(Z) * (Z + 1)] = 0
rmse = lambda x: float(np.sqrt(np.mean((x - x_true) ** 2)))

# ---------------------------------------------------------------- estimation with the true route choice
lam, scores = select_lambda(P_true, x0, obs)
est = estimate(P_true, x0, obs, lam)
ok("solver converges", est.converged, est.info["message"])
# (single OD cells are not identifiable from ~36 links: expect a modest gain there and a large one in the flows)
ok("OD cells are closer to the truth than the prior", rmse(est.x) < 0.9 * rmse(x0), f"RMSE {rmse(x0):.1f} -> {rmse(est.x):.1f} (lam {lam})")
uncounted = np.setdiff1d(np.arange(net.n_links), counted)
g_prior, g_est = geh((P_true @ x0)[uncounted], flow_true[uncounted]).mean(), geh(est.flows[uncounted], flow_true[uncounted]).mean()
ok("flows on links nobody counted are recovered", g_est < 0.6 * g_prior, f"mean GEH {g_prior:.2f} -> {g_est:.2f}")
ok("the prior's bias in total demand is reduced", abs(est.x.sum() - x_true.sum()) < 0.6 * abs(x0.sum() - x_true.sum()),
   f"total {x0.sum():.0f} -> {est.x.sum():.0f} (true {x_true.sum():.0f})")
ok("fits the counts it saw (GEH < 5 on >= 85 %)", est.fit["passes"], f"{est.fit['under5_pct']:.0f} %")
held = cross_validate(P_true, x0, obs, lam)
prior_geh = geh((P_true @ x0)[counted], flow_true[counted])
ok("held-out GEH beats the prior's", held["mean"] < prior_geh.mean(), f"held-out mean GEH {held['mean']:.2f} vs prior {prior_geh.mean():.2f}")
ok("speed bounds are respected", est.bound_violations <= 0.05 * len(obs), f"{est.bound_violations} violations")
ok("no negative trips", np.all(est.x >= 0))

seen = np.asarray(P_true[counted].sum(axis=0)).ravel() > 0
offdiag = x0 > 0
ok("pairs crossing counted links lean on the data", est.data_share[seen & offdiag].mean() > est.data_share[~seen & offdiag].mean() if (~seen & offdiag).any() else est.data_share[offdiag].mean() > 0.3,
   f"mean data share {est.data_share[seen & offdiag].mean():.2f}")
inside = np.abs(est.x - x_true)[offdiag] < 2.5 * est.se[offdiag] + 1e-6
ok("standard errors are not overconfident", inside.mean() > 0.6, f"{inside.mean():.0%} of true values within 2.5 SE")

# ---------------------------------------------------------------- with no data, the prior is all there is (and said so)
blind = estimate(P_true, x0, [], lam=1.0)
ok("without observations the estimate is the prior", np.allclose(blind.x, x0, rtol=1e-5))
ok("without observations the data share is zero", np.allclose(blind.data_share[offdiag], 0, atol=1e-6))
rel = estimate(P_true, x0, [], lam=prior_weights(x0, 0.8))
ok("relative prior: standard error is cv times the prior", np.allclose(rel.se[offdiag], 0.8 * x0[offdiag], rtol=1e-3))
rel_fit = estimate(P_true, x0, obs, lam=prior_weights(x0, 1.0))
ok("relative prior also recovers uncounted flows", geh(rel_fit.flows[uncounted], flow_true[uncounted]).mean() < 0.6 * g_prior,
   f"mean GEH {g_prior:.2f} -> {geh(rel_fit.flows[uncounted], flow_true[uncounted]).mean():.2f} (cv 1.0)")

# ---------------------------------------------------------------- correlated prior errors: zone factors
# A prior wrong by zone (each origin's trips off by its own factor) is what a land-use model gets wrong; the
# zone factors should let the counts fix that, where independent per-pair errors cannot.
zone_bias = np.repeat(rng.lognormal(0, 0.5, Z), Z)
x0z = x_true * zone_bias; x0z[np.arange(Z) * (Z + 1)] = 0
plain = estimate(P_true, x0z, obs, lam=prior_weights(x0z, 0.5))
factored = estimate(P_true, x0z, obs, lam=prior_weights(x0z, 0.5), zones=Z)
g_plain, g_fact = geh(plain.flows[uncounted], flow_true[uncounted]).mean(), geh(factored.flows[uncounted], flow_true[uncounted]).mean()
ok("zone factors recover a prior wrong by zone", g_fact < 0.8 * g_plain, f"uncounted mean GEH {g_plain:.2f} -> {g_fact:.2f}")
ok("zone factors fit the counts", factored.fit["under5_pct"] >= plain.fit["under5_pct"], f"{plain.fit['under5_pct']:.0f} % -> {factored.fit['under5_pct']:.0f} %")

# ---------------------------------------------------------------- a count across both directions of a road
pair = [e for e in range(net.n_links) if (net.head[e], net.tail[e]) in zip(net.tail, net.head)][:2]
e1 = pair[0]; e2 = [e for e in range(net.n_links) if net.tail[e] == net.head[e1] and net.head[e] == net.tail[e1]][0]
both = Observation((e1, e2), flow_true[e1] + flow_true[e2], 0.02 * (flow_true[e1] + flow_true[e2]), "count", "screenline")
fit2 = estimate(P_true, x0, [both], lam=prior_weights(x0, 1.0))
ok("a two-direction count is matched by the sum of both links", abs(observed(both, fit2.flows) - both.value) < 3 * both.sd,
   f"{observed(both, fit2.flows):.0f} vs {both.value:.0f}")

# ---------------------------------------------------------------- bilevel: route choice re-estimated with the OD
# Routes now unknown too: OD cells are no longer expected to beat the prior, the network flows are.
bi = estimate_bilevel(net, x0, obs, lam)
rounds = bi.info["bilevel"]
ok("bilevel settles (successive averages)", rounds[-1]["od_change"] < 5e-3, f"OD change {rounds[0]['od_change']:.3f} -> {rounds[-1]['od_change']:.4f} in {len(rounds)} rounds")
bi_flows, _, _ = assign(net, bi.x)
fixed = estimate(assign(net, x0)[1], x0, obs, lam)  # the shortcut: routes frozen at the prior's
g_bi, g_fixed = geh(bi_flows[uncounted], flow_true[uncounted]).mean(), geh(fixed.flows[uncounted], flow_true[uncounted]).mean()
ok("bilevel recovers uncounted flows", g_bi < 0.75 * g_prior, f"mean GEH {g_prior:.2f} -> {g_bi:.2f}")
ok("bilevel beats routes frozen at the prior", g_bi < g_fixed, f"mean GEH {g_bi:.2f} vs {g_fixed:.2f} frozen")
ok("bilevel fit passes GEH", bi.fit["passes"], f"{bi.fit['under5_pct']:.0f} %")

print(f"\n{passed} checks passed")
