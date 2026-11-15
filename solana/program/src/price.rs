use crate::error::E;
use crate::math::E9;
use crate::state::{byte, entry, i64_at, oracle, u32_at, u64_at, FX, GUARDIAN, HALTED};

pub struct Ctx<'a> {
    pub oracle: &'a [u8],
    pub now: i64,
}

impl Ctx<'_> {
    fn reported(&self, o: usize) -> Option<u64> {
        let p = u64_at(self.oracle, o + entry::PRICE);
        let at = i64_at(self.oracle, o + entry::OBSERVED_AT);
        let max_age = u32_at(self.oracle, oracle::REPORT_MAX_AGE) as i64;
        (p != 0 && self.now <= at.saturating_add(max_age)).then_some(p)
    }

    pub fn is_fx(&self, o: usize) -> bool {
        byte(self.oracle, o + entry::FLAGS) & FX != 0
    }

    pub fn is_halted(&self, o: usize) -> bool {
        byte(self.oracle, o + entry::FLAGS) & (HALTED | GUARDIAN) != 0
    }

    pub fn price(&self, o: usize) -> Result<u64, E> {
        if !self.is_fx(o) {
            return Ok(E9 as u64);
        }
        self.reported(o).ok_or(E::StaleRate)
    }

    pub fn depeg_price(&self, o: usize) -> Result<u64, E> {
        if !self.is_halted(o) {
            return Err(E::NotDepegged);
        }
        self.reported(o).ok_or(E::StaleRate)
    }
}
