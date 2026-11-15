use crate::error::E;

pub const BPS: u128 = 10_000;
pub const WAD: u128 = 1_000_000_000_000_000_000;
pub const E9: u128 = 1_000_000_000;
pub const MAX_COINS: usize = 8;

#[derive(Clone, Copy)]
pub struct Range {
    pub floor: u128,
    pub sum_cap_ratio: u128,
    pub fee_bps: u16,
    pub max_share_bps: u16,
}

#[derive(Clone, Copy)]
pub struct Coins {
    pub n: usize,
    pub real: [u64; MAX_COINS],
    pub price: [u64; MAX_COINS],
    pub unit: [u64; MAX_COINS],
}

#[inline]
fn mul(a: u128, b: u128) -> Result<u128, E> {
    a.checked_mul(b).ok_or(E::Overflow)
}

#[inline]
fn div(a: u128, b: u128) -> Result<u128, E> {
    a.checked_div(b).ok_or(E::Overflow)
}

#[inline]
fn add(a: u128, b: u128) -> Result<u128, E> {
    a.checked_add(b).ok_or(E::Overflow)
}

pub fn pow10(d: u8) -> u64 {
    10u64.pow(d as u32)
}

fn virtuals(c: &Coins, real: &[u64; MAX_COINS], floor: u128) -> Result<[u128; MAX_COINS], E> {
    let mut v = [0u128; MAX_COINS];
    for k in 0..c.n.min(MAX_COINS) {
        v[k] = add(div(mul(real[k] as u128, c.price[k] as u128)?, c.unit[k] as u128)?, floor)?;
    }
    Ok(v)
}

pub fn radius(v: &[u128; MAX_COINS], n: usize) -> Result<u128, E> {
    let mut s = 0u128;
    let mut q = 0u128;
    for x in v.iter().take(n) {
        s = add(s, *x)?;
        q = add(q, mul(*x, *x)?)?;
    }
    let ss = mul(s, s)?;
    let nq = mul(n.saturating_sub(1) as u128, q)?;
    if ss < nq {
        return Err(E::OffSurface);
    }
    div(add(s, sqrt(ss - nq))?, n.saturating_sub(1) as u128)
}

fn sum_sq_except(v: &[u128; MAX_COINS], n: usize, r: u128, i: usize, j: usize) -> Result<u128, E> {
    let mut s = 0u128;
    for (k, x) in v.iter().enumerate().take(n) {
        if k == i || k == j {
            continue;
        }
        if *x > r {
            return Err(E::OutOfRange);
        }
        let d = r - *x;
        s = add(s, mul(d, d)?)?;
    }
    Ok(s)
}

pub fn exact_in(c: &Coins, p: &Range, i: usize, j: usize, amount_in: u64) -> Result<u64, E> {
    if i == j {
        return Err(E::SameToken);
    }
    if c.n < 2 || c.n > MAX_COINS || i >= c.n || j >= c.n {
        return Err(E::OutOfRange);
    }
    let (i, j) = (i % MAX_COINS, j % MAX_COINS);
    if amount_in == 0 {
        return Err(E::ZeroAmount);
    }
    let v = virtuals(c, &c.real, p.floor)?;
    let r = radius(&v, c.n)?;

    let net = mul(amount_in as u128, BPS - p.fee_bps as u128)? / BPS;
    let vi = add(v[i], div(mul(net, c.price[i] as u128)?, c.unit[i] as u128)?)?;
    if vi > r {
        return Err(E::OutOfRange);
    }
    let rr = mul(r, r)?;
    let t = add(sum_sq_except(&v, c.n, r, i, j)?, mul(r - vi, r - vi)?)?;
    if t > rr {
        return Err(E::OutOfRange);
    }
    let vj = r - sqrt(rr - t);
    if vj >= v[j] {
        return Err(E::ZeroAmount);
    }
    let out = div(mul(v[j] - vj, c.unit[j] as u128)?, c.price[j] as u128)?;
    if out <= 1 {
        return Err(E::ZeroAmount);
    }
    let out = u64::try_from(out - 1).map_err(|_| E::Overflow)?;
    verify(c, p, i, j, amount_in, out, r)?;
    Ok(out)
}

fn verify(c: &Coins, p: &Range, i: usize, j: usize, amount_in: u64, amount_out: u64, r_before: u128) -> Result<(), E> {
    if i >= MAX_COINS || j >= MAX_COINS {
        return Err(E::OutOfRange);
    }
    let (i, j) = (i % MAX_COINS, j % MAX_COINS);
    if amount_out > c.real[j] {
        return Err(E::InsufficientReserve);
    }
    let mut next = c.real;
    next[i] = next[i].checked_add(amount_in).ok_or(E::Overflow)?;
    next[j] -= amount_out;
    let v = virtuals(c, &next, p.floor)?;
    let mut sum_v = 0u128;
    let mut total = 0u128;
    let mut heaviest = 0u128;
    for x in v.iter().take(c.n) {
        sum_v = add(sum_v, *x)?;
        total = add(total, *x - p.floor)?;
        if *x > heaviest {
            heaviest = *x;
        }
    }
    if mul(sum_v, WAD)? > mul(p.sum_cap_ratio, r_before)? && v[i] == heaviest {
        return Err(E::RangeEdge);
    }
    if (p.max_share_bps as u128) < BPS && mul(v[i] - p.floor, BPS)? > mul(p.max_share_bps as u128, total)? {
        return Err(E::ExposureCap);
    }
    if radius(&v, c.n)? < r_before {
        return Err(E::ValueDecreased);
    }
    Ok(())
}

pub struct BackstopQuote {
    pub amount_in: u64,
    pub absorbed_in: u64,
    pub face_in: u64,
    pub market_in: u64,
    pub price_out: u64,
    pub unit_in: u64,
    pub unit_out: u64,
    pub start_bps: u16,
    pub end_bps: u16,
    pub cap: u64,
}

pub fn backstop_out(x: &BackstopQuote) -> Result<u64, E> {
    if x.amount_in == 0 {
        return Err(E::ZeroAmount);
    }
    let unit_in = x.unit_in as u128;
    let absorbed = div(mul(x.absorbed_in as u128, x.face_in as u128)?, unit_in)?;
    let incoming = div(mul(x.amount_in as u128, x.face_in as u128)?, unit_in)?;
    if add(absorbed, incoming)? > x.cap as u128 {
        return Err(E::BackstopFull);
    }
    let span = x.end_bps.saturating_sub(x.start_bps) as u128;
    let two_cap = 2 * x.cap as u128;
    let numer = add(mul(x.start_bps as u128, two_cap)?, mul(span, add(2 * absorbed, incoming)?)?)?;
    if two_cap == 0 {
        return Err(E::Overflow);
    }
    let discount = ceil_div(mul(numer, 100_000)?, two_cap);
    if discount >= E9 {
        return Err(E::ZeroAmount);
    }
    let market = x.market_in.min(x.face_in) as u128;
    let value = div(mul(mul(x.amount_in as u128, market)?, E9 - discount)?, mul(unit_in, E9)?)?;
    let out = div(mul(value, x.unit_out as u128)?, x.price_out as u128)?;
    if out <= 1 {
        return Err(E::ZeroAmount);
    }
    u64::try_from(out - 1).map_err(|_| E::Overflow)
}

pub fn ceil_div(a: u128, b: u128) -> u128 {
    if a == 0 || b == 0 {
        0
    } else {
        (a - 1) / b + 1
    }
}

pub fn sqrt(a: u128) -> u128 {
    if a < 2 {
        return a;
    }
    let mut x = 1u128 << ((128 - a.leading_zeros()).div_ceil(2));
    loop {
        let y = (x + a / x.max(1)) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coins(real: &[u64], price: &[u64], dec: &[u8]) -> Coins {
        let mut c = Coins { n: real.len(), real: [0; MAX_COINS], price: [0; MAX_COINS], unit: [1; MAX_COINS] };
        for k in 0..real.len() {
            c.real[k] = real[k];
            c.price[k] = price[k];
            c.unit[k] = pow10(dec[k]);
        }
        c
    }

    #[test]
    fn sqrt_is_floor() {
        for a in [0u128, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, u64::MAX as u128, u128::MAX, u128::MAX / 3, 1 << 100] {
            let s = sqrt(a);
            assert!(s * s <= a);
            assert!((s + 1).checked_mul(s + 1).map_or(true, |x| x > a));
        }
    }

    #[test]
    fn swap_moves_value_and_keeps_radius() {
        let c = coins(&[1_000_000_000_000, 1_000_000_000_000, 1_000_000_000_000], &[1_000_000_000; 3], &[6, 6, 6]);
        let p = Range { floor: 0, sum_cap_ratio: u64::MAX as u128, fee_bps: 1, max_share_bps: 10_000 };
        let out = exact_in(&c, &p, 0, 1, 1_000_000_000).unwrap();
        assert!(out < 1_000_000_000 && out > 999_000_000, "{out}");
    }

    #[test]
    fn concentrated_range_is_tight() {
        let c = coins(&[100_000_000, 100_000_000, 100_000_000], &[1_000_000_000; 3], &[6, 6, 6]);
        let p = Range { floor: 5_000 * E9, sum_cap_ratio: u64::MAX as u128, fee_bps: 0, max_share_bps: 10_000 };
        let out = exact_in(&c, &p, 0, 1, 10_000_000).unwrap();
        assert!(out > 9_980_000 && out < 10_000_000, "{out}");
    }

    #[test]
    fn backstop_discount_grows() {
        let q = |absorbed| BackstopQuote {
            amount_in: 100_000_000,
            absorbed_in: absorbed,
            face_in: 1_000_000_000,
            market_in: 930_000_000,
            price_out: 1_000_000_000,
            unit_in: 1_000_000,
            unit_out: 1_000_000,
            start_bps: 200,
            end_bps: 1000,
            cap: 1_000 * 1_000_000_000,
        };
        let a = backstop_out(&q(0)).unwrap();
        let b = backstop_out(&q(800_000_000)).unwrap();
        assert!(a > b);
        assert!(a < 93_000_000);
        assert_eq!(backstop_out(&q(950_000_000)).unwrap_err(), E::BackstopFull);
    }
}
