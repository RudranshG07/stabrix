use stabrix::math::{backstop_out, exact_in, pow10, BackstopQuote, Coins, Range, E9, MAX_COINS};

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 11
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
}

fn result(r: Result<u64, stabrix::error::E>) -> String {
    match r {
        Ok(v) => format!("\"{v}\""),
        Err(e) => format!("\"{e:?}\""),
    }
}

#[test]
fn vectors() {
    let Ok(path) = std::env::var("STABRIX_VECTORS") else {
        return;
    };
    let mut rng = Lcg(7);
    let mut cases = Vec::new();
    let decs = [6u8, 6, 6, 6, 9, 4, 6, 6];
    for _ in 0..400 {
        let n = rng.range(2, 8) as usize;
        let mut c = Coins { n, real: [0; MAX_COINS], price: [0; MAX_COINS], unit: [1; MAX_COINS] };
        let mut dec = Vec::new();
        for k in 0..n {
            let d = decs[(rng.next() as usize) % decs.len()];
            dec.push(d);
            c.unit[k] = pow10(d);
            c.price[k] = if rng.range(0, 3) == 0 { rng.range(150_000_000, 1_200_000_000) } else { rng.range(990_000_000, 1_010_000_000) };
            c.real[k] = rng.range(1, 5_000_000) * c.unit[k] / rng.range(1, 10);
        }
        let floor = rng.range(0, 300) as u128 * rng.range(1, 2_000_000) as u128 * E9;
        let p = Range {
            floor,
            sum_cap_ratio: rng.range(1_000_000_000_000_000_000, 9_000_000_000_000_000_000) as u128,
            fee_bps: rng.range(0, 30) as u16,
            max_share_bps: rng.range(1000, 10_000) as u16,
        };
        let i = rng.range(0, n as u64 - 1) as usize;
        let mut j = rng.range(0, n as u64 - 1) as usize;
        if j == i {
            j = (i + 1) % n;
        }
        let amount = rng.range(1, 200_000) * c.unit[i] / rng.range(1, 100);
        let out = result(exact_in(&c, &p, i, j, amount));
        let join = |v: &[u64]| v.iter().map(|x| format!("\"{x}\"")).collect::<Vec<_>>().join(",");
        cases.push(format!(
            "{{\"kind\":\"range\",\"real\":[{}],\"price\":[{}],\"decimals\":{:?},\"floor\":\"{}\",\"sumCapRatio\":\"{}\",\"feeBps\":{},\"maxShareBps\":{},\"i\":{},\"j\":{},\"amountIn\":\"{}\",\"out\":{}}}",
            join(&c.real[..n]), join(&c.price[..n]), dec, p.floor, p.sum_cap_ratio, p.fee_bps, p.max_share_bps, i, j, amount, out
        ));
    }
    for _ in 0..200 {
        let di = decs[(rng.next() as usize) % decs.len()];
        let dout = decs[(rng.next() as usize) % decs.len()];
        let start = rng.range(0, 1000) as u16;
        let q = BackstopQuote {
            amount_in: rng.range(1, 100_000) * pow10(di) / rng.range(1, 50),
            absorbed_in: rng.range(0, 100_000) * pow10(di),
            face_in: rng.range(900_000_000, 1_200_000_000),
            market_in: rng.range(500_000_000, 1_100_000_000),
            price_out: rng.range(150_000_000, 1_200_000_000),
            unit_in: pow10(di),
            unit_out: pow10(dout),
            start_bps: start,
            end_bps: start + rng.range(0, 4000) as u16,
            cap: rng.range(1, 300_000) * 1_000_000_000,
        };
        let out = result(backstop_out(&q));
        cases.push(format!(
            "{{\"kind\":\"backstop\",\"amountIn\":\"{}\",\"absorbedIn\":\"{}\",\"faceIn\":\"{}\",\"marketIn\":\"{}\",\"priceOut\":\"{}\",\"decimalsIn\":{},\"decimalsOut\":{},\"startBps\":{},\"endBps\":{},\"cap\":\"{}\",\"out\":{}}}",
            q.amount_in, q.absorbed_in, q.face_in, q.market_in, q.price_out, di, dout, q.start_bps, q.end_bps, q.cap, out
        ));
    }
    std::fs::write(path, format!("[{}]", cases.join(",\n"))).unwrap();
}
