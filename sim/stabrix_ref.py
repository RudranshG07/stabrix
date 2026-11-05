# Stabrix reference model (integer, WAD). Orbital range + upgrades:
#  - radius re-derived from live balances every swap (fees/yield compound to LP, no drift capture)
#  - exact-in AND exact-out closed form
#  - LP fee inside instruction; safety net: post-trade radius >= pre-trade radius
#  - per-LP max exposure to any one coin
import math, random
W=10**18
def isqrt(x): return math.isqrt(x)
def radius(v, n):
    S=sum(v); Q=sum(x*x for x in v)
    d=S*S-(n-1)*Q
    if d<0: raise ValueError("off-surface")
    return (S+isqrt(d))//(n-1)          # floor => conservative
class Range:
    def __init__(s, real, m, capFrac, feeBps, maxShareBps):
        s.real=real[:]; s.m=m; s.n=len(real); s.fee=feeBps; s.maxShare=maxShareBps
        v=s.v(); s.r0=radius(v,s.n)
        veq=s.r0 - s.r0*10**9//isqrt(s.n*10**18)   # r(1-1/sqrt n)
        s.capK = s.n*veq + (sum(v)*0) ; s.capK = int(sum(v)*capFrac)  # sum cap relative to deposit
    def v(s): return [x+s.m for x in s.real]
    def exact_in(s,i,j,a):
        v=s.v(); n=s.n; r=radius(v,n)
        net=a*(10000-s.fee)//10000
        vi=v[i]+net
        S=sum((r-x)**2 for k,x in enumerate(v) if k not in (i,j)) + (r-vi)**2
        if S>r*r or vi>r: raise ValueError("range")
        vj=r-isqrt(r*r-S); out=v[j]-vj
        if out<=0: raise ValueError("zero")
        return s._commit(i,j,a,out)
    def exact_out(s,i,j,b):
        v=s.v(); n=s.n; r=radius(v,n)
        vj=v[j]-b
        if vj<s.m: raise ValueError("floor")
        T=sum((r-x)**2 for k,x in enumerate(v) if k not in (i,j)) + (r-vj)**2
        if T>r*r: raise ValueError("range")
        vi=r-isqrt(r*r-T)             # r - floor(sqrt) -> vi rounds up -> more input
        net=vi-v[i]
        a=-(-net*10000//(10000-s.fee)) # ceil gross
        return s._commit(i,j,a,b)
    def _commit(s,i,j,a,out):
        before=radius(s.v(),s.n)
        new=s.real[:]; new[i]+=a; new[j]-=out
        if new[j]<0: raise ValueError("floor")
        nv=[x+s.m for x in new]
        if sum(nv)>s.capK: raise ValueError("range edge")
        if new[i]*10000 > s.maxShare*sum(new): raise ValueError("exposure cap")
        after=radius(nv,s.n)
        assert after>=before, ("LP value decreased", before, after)
        s.real=new; return a,out
n=5; R=0
def fresh(m_frac=0.9, fee=1, cap=1.02, share=10000):
    # equal-price point for chosen virtual size 1000/asset
    V=1000*W; m=int(V*m_frac); return Range([V-m]*n, m, cap, fee, share)
p=fresh(); a,o=p.exact_in(0,2,10*W); print("exactIn 10 ->", o/W)
p=fresh(); a2,_=p.exact_out(0,2,o); print("exactOut back needs", a2/W, "(symmetry diff wei:", a2-10*W, ")")
# fees compound: radius grows
p=fresh(fee=5); r0=radius(p.v(),n)
for _ in range(200):
    i,j=random.sample(range(n),2)
    try: p.exact_in(i,j,random.randint(1,5*W))
    except ValueError: pass
print("radius growth after 200 swaps (fees to LP): +%.6f%%"%((radius(p.v(),n)-r0)*100/r0))
# fuzz: LP value never decreases, both directions, any pair
random.seed(7); fails=0
for t in range(3000):
    p=fresh(m_frac=random.choice([0,0.5,0.9,0.97]), fee=random.choice([0,1,5,30]), cap=random.choice([1.005,1.02,1.1]), share=random.choice([10000,4000,3000]))
    for _ in range(8):
        i,j=random.sample(range(n),2); amt=random.randint(1, 60*W)
        try: (p.exact_in if random.random()<.5 else p.exact_out)(i,j,amt)
        except ValueError: pass
        except AssertionError: fails+=1
print("fuzz LP-value-decrease failures:", fails)
# exposure cap demo: LP says max 30% in any coin; dump coin 4
p=fresh(share=3000); dumped=0
while True:
    try: p.exact_in(4,0,2*W); dumped+=2
    except ValueError as e: why=str(e); break
print("max-30%% LP stopped after absorbing %d of the dumped coin (%s); holdings:"%(dumped,why), [round(x/W,1) for x in p.real])
