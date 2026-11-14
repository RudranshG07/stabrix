use pinocchio::program_error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum E {
    SameToken = 6000,
    ZeroAmount,
    OffSurface,
    OutOfRange,
    InsufficientReserve,
    RangeEdge,
    ExposureCap,
    ValueDecreased,
    Overflow,
    BackstopFull,
    Halted,
    NotDepegged,
    PayoutHalted,
    StaleRate,
    MissingFeed,
    InsufficientLiquidity,
    Slippage,
    Unauthorized,
    BadAccount,
    BadConfig,
    UnknownCoin,
    FutureReport,
    OracleFull,
    BadTokenProgram,
}

impl From<E> for ProgramError {
    fn from(e: E) -> Self {
        ProgramError::Custom(e as u32)
    }
}
