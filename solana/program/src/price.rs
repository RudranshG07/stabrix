use pinocchio::{account_info::AccountInfo, pubkey::Pubkey};

use crate::error::E;
use crate::math::{BPS, E9};
use crate::state::{entry, i64_at, key_at, oracle, u16_at, u32_at, u64_at, FX, GUARDIAN, HALTED};

pub const PYTH_RECEIVER: Pubkey = [
    12, 183, 250, 187, 82, 247, 166, 72, 187, 91, 49, 125, 154, 1, 139, 144, 87, 203, 2, 71, 116, 250, 254, 1, 230, 196,
    223, 152, 204, 56, 88, 129,
];
const PRICE_UPDATE_V2: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

pub struct Ctx<'a> {
    pub oracle: &'a [u8],
    pub feeds: &'a [AccountInfo],
    pub now: i64,
}

fn fresh(at: i64, max_age: u32, now: i64) -> bool {
    now <= at.saturating_add(max_age as i64)
}

pub fn read_pyth(acc: &AccountInfo, max_age: u32, now: i64) -> Result<Option<u64>, E> {
    if !acc.is_owned_by(&PYTH_RECEIVER) {
        return Err(E::BadAccount);
    }
    let d = acc.try_borrow_data().map_err(|_| E::BadAccount)?;
    if d.len() < 101 || d[..8] != PRICE_UPDATE_V2 || d[40] != 1 {
        return Err(E::BadAccount);
    }
    let price = i64_at(&d, 73);
    let expo = u32_at(&d, 89) as i32;
    let published = i64_at(&d, 93);
    if price <= 0 || !fresh(published, max_age, now) {
        return Ok(None);
    }
    let shift = 9 + expo;
    let p = price as u128;
    let scaled = if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32)).ok_or(E::Overflow)?
    } else {
        p / 10u128.pow((-shift) as u32)
    };
    Ok(u64::try_from(scaled).ok().filter(|v| *v > 0))
}

impl Ctx<'_> {
    fn feed(&self, key: &Pubkey) -> Result<&AccountInfo, E> {
        self.feeds.iter().find(|a| a.key() == key).ok_or(E::MissingFeed)
    }

    fn reported(&self, o: usize) -> Option<u64> {
        let p = u64_at(self.oracle, o + entry::PRICE);
        let at = i64_at(self.oracle, o + entry::OBSERVED_AT);
        let max_age = u32_at(self.oracle, oracle::REPORT_MAX_AGE);
        (p != 0 && fresh(at, max_age, self.now)).then_some(p)
    }

    pub fn is_fx(&self, o: usize) -> bool {
        self.oracle[o + entry::FLAGS] & FX != 0
    }

    pub fn is_halted(&self, o: usize) -> bool {
        self.oracle[o + entry::FLAGS] & (HALTED | GUARDIAN) != 0
    }

    pub fn price(&self, o: usize) -> Result<u64, E> {
        if !self.is_fx(o) {
            return Ok(E9 as u64);
        }
        let ref_feed = key_at(self.oracle, o + entry::REF_FEED);
        if ref_feed == [0u8; 32] {
            return self.reported(o).ok_or(E::StaleRate);
        }
        let reference = read_pyth(self.feed(&ref_feed)?, u32_at(self.oracle, o + entry::REF_MAX_AGE), self.now)?
            .ok_or(E::StaleRate)?;
        let Some(p) = self.reported(o) else {
            return Ok(reference);
        };
        let diff = p.abs_diff(reference) as u128;
        let max_dev = u16_at(self.oracle, oracle::MAX_DEV_BPS) as u128;
        Ok(if diff * BPS > reference as u128 * max_dev { reference } else { p })
    }

    pub fn depeg_price(&self, o: usize) -> Result<u64, E> {
        if !self.is_halted(o) {
            return Err(E::NotDepegged);
        }
        let mut best = self.reported(o).unwrap_or(u64::MAX);
        let market = key_at(self.oracle, o + entry::MARKET_FEED);
        if market != [0u8; 32] {
            if let Some(p) = read_pyth(self.feed(&market)?, u32_at(self.oracle, o + entry::MARKET_MAX_AGE), self.now)? {
                best = best.min(p);
            }
        }
        if best == u64::MAX {
            return Err(E::StaleRate);
        }
        Ok(best)
    }
}
