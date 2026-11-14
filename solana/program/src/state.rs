use pinocchio::pubkey::Pubkey;

pub const ORACLE_TAG: u8 = 1;
pub const RANGE_TAG: u8 = 2;
pub const BACKSTOP_TAG: u8 = 3;

pub const MAX_ENTRIES: usize = 10;
pub const ENTRY_LEN: usize = 128;
pub const ORACLE_HEADER: usize = 80;
pub const ORACLE_LEN: usize = ORACLE_HEADER + MAX_ENTRIES * ENTRY_LEN;

pub mod oracle {
    pub const BUMP: usize = 1;
    pub const COUNT: usize = 2;
    pub const REPORT_MAX_AGE: usize = 4;
    pub const MAX_DEV_BPS: usize = 8;
    pub const ADMIN: usize = 16;
    pub const REPORTER: usize = 48;
}

pub mod entry {
    pub const MINT: usize = 0;
    pub const REF_FEED: usize = 32;
    pub const MARKET_FEED: usize = 64;
    pub const PRICE: usize = 96;
    pub const OBSERVED_AT: usize = 104;
    pub const REF_MAX_AGE: usize = 112;
    pub const MARKET_MAX_AGE: usize = 116;
    pub const DECIMALS: usize = 120;
    pub const FLAGS: usize = 121;
    pub const TOKEN_PROGRAM: usize = 122;
}

pub const FX: u8 = 1;
pub const HALTED: u8 = 2;
pub const GUARDIAN: u8 = 4;

pub const STRATEGY_LEN: usize = 408;

pub mod strategy {
    pub const BUMP: usize = 1;
    pub const DELEGATE_BUMP: usize = 2;
    pub const N: usize = 3;
    pub const P1: usize = 4;
    pub const P2: usize = 6;
    pub const P3: usize = 8;
    pub const SALT: usize = 16;
    pub const OPENED_AT: usize = 24;
    pub const MAKER: usize = 32;
    pub const A: usize = 64;
    pub const B: usize = 72;
    pub const MINTS: usize = 80;
    pub const BALANCES: usize = 336;
    pub const DECIMALS: usize = 400;
}

pub mod token {
    pub const MINT: usize = 0;
    pub const OWNER: usize = 32;
    pub const AMOUNT: usize = 64;
    pub const DELEGATE_TAG: usize = 72;
    pub const DELEGATE: usize = 76;
    pub const STATE: usize = 108;
    pub const DELEGATED_AMOUNT: usize = 121;
    pub const LEN: usize = 165;
}

#[inline]
pub fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}

#[inline]
pub fn u32_at(d: &[u8], o: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&d[o..o + 4]);
    u32::from_le_bytes(b)
}

#[inline]
pub fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}

#[inline]
pub fn i64_at(d: &[u8], o: usize) -> i64 {
    u64_at(d, o) as i64
}

#[inline]
pub fn key_at(d: &[u8], o: usize) -> Pubkey {
    let mut k = [0u8; 32];
    k.copy_from_slice(&d[o..o + 32]);
    k
}

#[inline]
pub fn put(d: &mut [u8], o: usize, bytes: &[u8]) {
    d[o..o + bytes.len()].copy_from_slice(bytes);
}

pub fn entry_offset(k: usize) -> usize {
    ORACLE_HEADER + k * ENTRY_LEN
}

pub fn find_entry(oracle: &[u8], mint: &Pubkey) -> Option<usize> {
    let count = oracle[oracle::COUNT] as usize;
    (0..count).map(entry_offset).find(|&o| oracle[o + entry::MINT..o + entry::MINT + 32] == mint[..])
}
