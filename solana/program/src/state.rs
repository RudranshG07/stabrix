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
    pub const PRICE: usize = 96;
    pub const OBSERVED_AT: usize = 104;
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

// Every reader below is called only on account data whose length was checked against the
// fixed layout first (oracle, strategy, token account, mint, program data), so the reads stay
// in bounds without pulling in the panic and formatting machinery.

#[inline(always)]
fn read<const N: usize>(d: &[u8], o: usize) -> [u8; N] {
    debug_assert!(o + N <= d.len());
    unsafe { core::ptr::read_unaligned(d.as_ptr().add(o) as *const [u8; N]) }
}

#[inline(always)]
pub fn byte(d: &[u8], o: usize) -> u8 {
    debug_assert!(o < d.len());
    unsafe { *d.get_unchecked(o) }
}

#[inline(always)]
pub fn set_byte(d: &mut [u8], o: usize, v: u8) {
    debug_assert!(o < d.len());
    unsafe { *d.get_unchecked_mut(o) = v }
}

#[inline(always)]
pub fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes(read(d, o))
}

#[inline(always)]
pub fn u32_at(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(read(d, o))
}

#[inline(always)]
pub fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(read(d, o))
}

#[inline(always)]
pub fn i64_at(d: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(read(d, o))
}

#[inline(always)]
pub fn key_at(d: &[u8], o: usize) -> Pubkey {
    read(d, o)
}

#[inline(always)]
pub fn put(d: &mut [u8], o: usize, bytes: &[u8]) {
    debug_assert!(o + bytes.len() <= d.len());
    unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), d.as_mut_ptr().add(o), bytes.len()) }
}

pub fn entry_offset(k: usize) -> usize {
    ORACLE_HEADER + k * ENTRY_LEN
}

pub fn entries(oracle: &[u8]) -> usize {
    (byte(oracle, oracle::COUNT) as usize).min(MAX_ENTRIES)
}

pub fn find_entry(oracle: &[u8], mint: &Pubkey) -> Option<usize> {
    (0..entries(oracle)).map(entry_offset).find(|&o| key_at(oracle, o + entry::MINT) == *mint)
}
