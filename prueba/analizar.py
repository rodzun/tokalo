import json, glob, sys, re, statistics as st, csv
S = sys.argv[1]
def eventos(l):
    d = json.JSONDecoder(); out = []
    for f in sorted(glob.glob(f"{S}/tail-{l}-*.json")):
        t = open(f).read(); i = 0
        while True:
            while i < len(t) and t[i].isspace(): i += 1
            if i >= len(t): break
            o, i = d.raw_decode(t, i); out.append(o)
    return out
def pct(v, p):
    v = sorted(v); return v[min(len(v)-1, int(round(p/100*(len(v)-1))))]
for l in ("py", "ts"):
    ev = eventos(l); g = {}
    for e in ev:
        m = re.search(r"t=([a-z]+)", e["event"]["request"]["url"])
        g.setdefault(m.group(1), []).append(e)
    print(f"== {l}: {len(ev)} eventos; outcomes:", {o: sum(1 for e in ev if e['outcome']==o) for o in {e['outcome'] for e in ev}})
    todos = [e["cpuTime"] for e in ev]
    for k, es in list(g.items()) + [("TODOS", ev)]:
        c = [e["cpuTime"] for e in es]; w = [e["wallTime"] for e in es]
        print(f"  {k:10} n={len(c):3} cpu ms: min={min(c)} prom={st.mean(c):.1f} p50={pct(c,50)} p95={pct(c,95)} max={max(c)} | >10ms: {sum(x>10 for x in c)} | wall prom={st.mean(w):.0f}")
    print("  frio cpu:", [e["cpuTime"] for e in g.get("frio", [])], " trasfrio:", [e["cpuTime"] for e in g.get("trasfrio", [])])
    print("  caliente cpu (orden):", [e["cpuTime"] for e in g.get("caliente", [])])
    r = list(csv.reader(open(f"{S}/curl-{l}.csv")))
    for k in ("frio", "trasfrio", "caliente", "rafaga"):
        t = [float(x[2])*1000 for x in r if re.match(k + r"\d", x[0])]
        print(f"  curl {k:9} n={len(t)} total ms: prom={st.mean(t):.0f} p50={pct(t,50):.0f} max={max(t):.0f}")
