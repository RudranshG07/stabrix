#![cfg_attr(target_os = "solana", no_std)]

pub mod error;
pub mod math;
pub mod price;
pub mod state;

#[cfg(target_os = "solana")]
mod program {
    use pinocchio::{
        account_info::AccountInfo,
        cpi::invoke_signed,
        instruction::{AccountMeta, Instruction, Seed, Signer},
        log::sol_log_data,
        program_error::ProgramError,
        pubkey::{create_program_address, try_find_program_address, Pubkey},
        sysvars::{clock::Clock, Sysvar},
        ProgramResult,
    };
    use pinocchio_system::instructions::CreateAccount;

    use crate::error::E;
    use crate::math::{self, BackstopQuote, Coins, Range, BPS, MAX_COINS};
    use crate::price::Ctx;
    use crate::state::*;

    pinocchio::lazy_program_entrypoint!(entry);

    const MAX_ACCOUNTS: usize = 12;

    fn entry(mut ctx: pinocchio::entrypoint::lazy::InstructionContext) -> ProgramResult {
        use core::mem::MaybeUninit;
        use pinocchio::entrypoint::lazy::MaybeAccount;
        let n = ctx.remaining() as usize;
        if n > MAX_ACCOUNTS {
            return Err(ProgramError::InvalidArgument);
        }
        let mut buf = [const { MaybeUninit::<AccountInfo>::uninit() }; MAX_ACCOUNTS];
        for k in 0..n {
            let a = match ctx.next_account()? {
                MaybeAccount::Account(a) => a,
                MaybeAccount::Duplicated(i) if (i as usize) < k => unsafe { buf.get_unchecked(i as usize).assume_init() },
                MaybeAccount::Duplicated(_) => return Err(ProgramError::InvalidArgument),
            };
            unsafe { buf.get_unchecked_mut(k).write(a) };
        }
        let accounts = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const AccountInfo, n) };
        let data = ctx.instruction_data()?;
        let program_id = ctx.program_id()?;
        process(program_id, accounts, data)
    }
    pinocchio::no_allocator!();
    pinocchio::nostd_panic_handler!();

    const TOKEN: Pubkey = [
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58,
        140, 245, 133, 126, 255, 0, 169,
    ];
    const TOKEN_2022: Pubkey = [
        6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77, 131, 185, 13, 39, 254,
        189, 249, 40, 216, 161, 139, 252,
    ];
    const LOADER: Pubkey = [
        2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22, 193, 36, 210, 192, 83,
        122, 16, 4, 128, 0, 0,
    ];
    const MAX_FEE_BPS: u16 = 1000;
    const MAX_DISCOUNT_BPS: u16 = 5000;
    const MAX_FUTURE: i64 = 300;

    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
        let (tag, rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
        match tag {
            0 => init_oracle(program_id, accounts, rest),
            1 => set_coin(program_id, accounts, rest),
            2 => set_config(program_id, accounts, rest),
            3 => report(program_id, accounts, rest),
            4 => guardian(program_id, accounts, rest),
            5 => open(program_id, accounts, rest),
            6 => close(program_id, accounts),
            7 => swap(program_id, accounts, rest),
            #[cfg(feature = "devnet")]
            8 => faucet(program_id, accounts, rest),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    fn args<const N: usize>(d: &[u8], o: usize) -> Result<[u8; N], ProgramError> {
        d.get(o..o + N)
            .and_then(|s| s.try_into().ok())
            .ok_or(ProgramError::InvalidInstructionData)
    }

    fn pda(seeds: &[&[u8]], program: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
        try_find_program_address(seeds, program).ok_or(ProgramError::InvalidSeeds)
    }

    fn now() -> Result<i64, ProgramError> {
        Ok(Clock::get()?.unix_timestamp)
    }

    fn signer(a: &AccountInfo) -> ProgramResult {
        if a.is_signer() {
            Ok(())
        } else {
            Err(ProgramError::MissingRequiredSignature)
        }
    }

    fn check_oracle(program_id: &Pubkey, a: &AccountInfo) -> ProgramResult {
        if !a.is_owned_by(program_id) || a.data_len() != ORACLE_LEN {
            return Err(E::BadAccount.into());
        }
        if byte(&a.try_borrow_data()?, 0) != ORACLE_TAG {
            return Err(E::BadAccount.into());
        }
        Ok(())
    }

    fn admin_oracle(program_id: &Pubkey, admin: &AccountInfo, oracle: &AccountInfo) -> ProgramResult {
        signer(admin)?;
        check_oracle(program_id, oracle)?;
        if key_at(&oracle.try_borrow_data()?, crate::state::oracle::ADMIN) != *admin.key() {
            return Err(E::Unauthorized.into());
        }
        Ok(())
    }

    fn check_limits(max_age: u32, max_dev: u16) -> ProgramResult {
        if max_age == 0 || max_dev == 0 || max_dev > 1000 {
            return Err(E::BadConfig.into());
        }
        Ok(())
    }

    fn create_pda(payer: &AccountInfo, target: &AccountInfo, program_id: &Pubkey, len: usize, lamports: u64, seeds: &[Seed]) -> ProgramResult {
        if target.lamports() != 0 || !target.data_is_empty() {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        CreateAccount {
            from: payer,
            to: target,
            lamports,
            space: len as u64,
            owner: program_id,
        }
        .invoke_signed(&[Signer::from(seeds)])
    }

    fn init_oracle(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [admin, oracle, program_data, _system] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(admin)?;
        let (expected_data, _) = pda(&[program_id.as_ref()], &LOADER)?;
        if program_data.key() != &expected_data || !program_data.is_owned_by(&LOADER) {
            return Err(E::BadAccount.into());
        }
        {
            let pd = program_data.try_borrow_data()?;
            if pd.len() < 45 || byte(&pd, 0) != 3 || byte(&pd, 12) != 1 || key_at(&pd, 13) != *admin.key() {
                return Err(E::Unauthorized.into());
            }
        }
        let reporter: [u8; 32] = args(d, 0)?;
        let max_age = u32::from_le_bytes(args(d, 32)?);
        let max_dev = u16::from_le_bytes(args(d, 36)?);
        let lamports = u64::from_le_bytes(args(d, 38)?);
        check_limits(max_age, max_dev)?;

        let (expected, bump) = pda(&[b"oracle"], program_id)?;
        if oracle.key() != &expected {
            return Err(E::BadAccount.into());
        }
        let bump_seed = [bump];
        create_pda(admin, oracle, program_id, ORACLE_LEN, lamports, &[Seed::from(b"oracle"), Seed::from(&bump_seed)])?;
        let mut o = oracle.try_borrow_mut_data()?;
        set_byte(&mut o, 0, ORACLE_TAG);
        set_byte(&mut o, crate::state::oracle::BUMP, bump);
        put(&mut o, crate::state::oracle::REPORT_MAX_AGE, &max_age.to_le_bytes());
        put(&mut o, crate::state::oracle::MAX_DEV_BPS, &max_dev.to_le_bytes());
        put(&mut o, crate::state::oracle::ADMIN, admin.key());
        put(&mut o, crate::state::oracle::REPORTER, &reporter);
        Ok(())
    }

    fn token_program_of(mint: &AccountInfo) -> Result<u8, ProgramError> {
        if mint.is_owned_by(&TOKEN) {
            Ok(0)
        } else if mint.is_owned_by(&TOKEN_2022) {
            Ok(1)
        } else {
            Err(E::BadTokenProgram.into())
        }
    }

    fn set_coin(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [admin, oracle, mint] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        admin_oracle(program_id, admin, oracle)?;
        let program = token_program_of(mint)?;
        let decimals = {
            let m = mint.try_borrow_data()?;
            if m.len() < 82 || byte(&m, 45) != 1 {
                return Err(E::BadAccount.into());
            }
            byte(&m, 44)
        };
        if decimals > 18 {
            return Err(E::BadConfig.into());
        }
        let fx = args::<1>(d, 0)?[0] != 0;

        let mut o = oracle.try_borrow_mut_data()?;
        let at = match find_entry(&o, mint.key()) {
            Some(at) => at,
            None => {
                let count = entries(&o);
                if count >= MAX_ENTRIES {
                    return Err(E::OracleFull.into());
                }
                set_byte(&mut o, crate::state::oracle::COUNT, count as u8 + 1);
                let at = entry_offset(count);
                put(&mut o, at + entry::MINT, mint.key());
                at
            }
        };
        set_byte(&mut o, at + entry::DECIMALS, decimals);
        set_byte(&mut o, at + entry::TOKEN_PROGRAM, program);
        let flags = byte(&o, at + entry::FLAGS);
        set_byte(&mut o, at + entry::FLAGS, (flags & !FX) | if fx { FX } else { 0 });
        Ok(())
    }

    fn set_config(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [admin, oracle] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        admin_oracle(program_id, admin, oracle)?;
        let new_admin: [u8; 32] = args(d, 0)?;
        let reporter: [u8; 32] = args(d, 32)?;
        let max_age = u32::from_le_bytes(args(d, 64)?);
        let max_dev = u16::from_le_bytes(args(d, 68)?);
        check_limits(max_age, max_dev)?;
        if new_admin == [0u8; 32] {
            return Err(E::BadConfig.into());
        }
        let mut o = oracle.try_borrow_mut_data()?;
        put(&mut o, crate::state::oracle::ADMIN, &new_admin);
        put(&mut o, crate::state::oracle::REPORTER, &reporter);
        put(&mut o, crate::state::oracle::REPORT_MAX_AGE, &max_age.to_le_bytes());
        put(&mut o, crate::state::oracle::MAX_DEV_BPS, &max_dev.to_le_bytes());
        Ok(())
    }

    fn report(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [reporter, oracle] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(reporter)?;
        check_oracle(program_id, oracle)?;
        let observed_at = i64::from_le_bytes(args(d, 0)?);
        let count = args::<1>(d, 8)?[0] as usize;
        if observed_at > now()? + MAX_FUTURE {
            return Err(E::FutureReport.into());
        }
        let mut o = oracle.try_borrow_mut_data()?;
        if key_at(&o, crate::state::oracle::REPORTER) != *reporter.key() {
            return Err(E::Unauthorized.into());
        }
        let listed = entries(&o);
        for k in 0..count {
            let base = 9 + k * 10;
            let index = args::<1>(d, base)?[0] as usize;
            let price = u64::from_le_bytes(args(d, base + 1)?);
            let halted = args::<1>(d, base + 9)?[0] != 0;
            if index >= listed {
                return Err(E::UnknownCoin.into());
            }
            let at = entry_offset(index);
            if observed_at <= i64_at(&o, at + entry::OBSERVED_AT) {
                continue;
            }
            put(&mut o, at + entry::PRICE, &price.to_le_bytes());
            put(&mut o, at + entry::OBSERVED_AT, &observed_at.to_le_bytes());
            let flags = byte(&o, at + entry::FLAGS);
            set_byte(&mut o, at + entry::FLAGS, (flags & !HALTED) | if halted { HALTED } else { 0 });
            sol_log_data(&[b"report", &key_at(&o, at + entry::MINT), &price.to_le_bytes(), &[halted as u8], &observed_at.to_le_bytes()]);
        }
        Ok(())
    }

    fn guardian(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [admin, oracle] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        admin_oracle(program_id, admin, oracle)?;
        let index = args::<1>(d, 0)?[0] as usize;
        let halted = args::<1>(d, 1)?[0] != 0;
        let mut o = oracle.try_borrow_mut_data()?;
        if index >= entries(&o) {
            return Err(E::UnknownCoin.into());
        }
        let at = entry_offset(index);
        let flags = byte(&o, at + entry::FLAGS);
        set_byte(&mut o, at + entry::FLAGS, if halted { flags | GUARDIAN } else { flags & !(GUARDIAN | HALTED) });
        sol_log_data(&[b"guardian", &key_at(&o, at + entry::MINT), &[halted as u8]]);
        Ok(())
    }

    fn open(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [maker, strat, oracle, _system] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(maker)?;
        check_oracle(program_id, oracle)?;
        let kind = args::<1>(d, 0)?[0];
        let salt: [u8; 8] = args(d, 1)?;
        let n = args::<1>(d, 9)?[0] as usize;
        let p1 = u16::from_le_bytes(args(d, 10)?);
        let p2 = u16::from_le_bytes(args(d, 12)?);
        let p3 = u16::from_le_bytes(args(d, 14)?);
        let a = u64::from_le_bytes(args(d, 16)?);
        let b = u64::from_le_bytes(args(d, 24)?);
        if !(2..=MAX_COINS).contains(&n) {
            return Err(E::BadConfig.into());
        }
        match kind {
            RANGE_TAG => {
                if p1 > MAX_FEE_BPS || p2 > MAX_FEE_BPS || p3 == 0 || p3 as u128 > BPS {
                    return Err(E::BadConfig.into());
                }
            }
            BACKSTOP_TAG => {
                if p1 > p2 || p2 > MAX_DISCOUNT_BPS || a == 0 {
                    return Err(E::BadConfig.into());
                }
            }
            _ => return Err(E::BadConfig.into()),
        }

        let (expected, bump) = pda(&[b"strategy", maker.key(), &salt], program_id)?;
        if strat.key() != &expected {
            return Err(E::BadAccount.into());
        }
        let (_, delegate_bump) = pda(&[b"delegate", maker.key()], program_id)?;
        let lamports = u64::from_le_bytes(args(d, 32 + 40 * n)?);
        let bump_seed = [bump];
        create_pda(
            maker,
            strat,
            program_id,
            STRATEGY_LEN,
            lamports,
            &[Seed::from(b"strategy"), Seed::from(maker.key()), Seed::from(&salt), Seed::from(&bump_seed)],
        )?;

        let o = oracle.try_borrow_data()?;
        let mut s = strat.try_borrow_mut_data()?;
        set_byte(&mut s, 0, kind);
        set_byte(&mut s, strategy::BUMP, bump);
        set_byte(&mut s, strategy::DELEGATE_BUMP, delegate_bump);
        set_byte(&mut s, strategy::N, n as u8);
        put(&mut s, strategy::P1, &p1.to_le_bytes());
        put(&mut s, strategy::P2, &p2.to_le_bytes());
        put(&mut s, strategy::P3, &p3.to_le_bytes());
        put(&mut s, strategy::SALT, &salt);
        put(&mut s, strategy::OPENED_AT, &now()?.to_le_bytes());
        put(&mut s, strategy::MAKER, maker.key());
        put(&mut s, strategy::A, &a.to_le_bytes());
        put(&mut s, strategy::B, &b.to_le_bytes());
        let mut prev = [0u8; 32];
        for k in 0..n {
            let mint: [u8; 32] = args(d, 32 + 32 * k)?;
            let amount: [u8; 8] = args(d, 32 + 32 * n + 8 * k)?;
            if k > 0 && mint <= prev {
                return Err(E::BadConfig.into());
            }
            prev = mint;
            let at = find_entry(&o, &mint).ok_or(E::UnknownCoin)?;
            put(&mut s, strategy::MINTS + 32 * k, &mint);
            put(&mut s, strategy::BALANCES + 8 * k, &amount);
            set_byte(&mut s, strategy::DECIMALS + k, byte(&o, at + entry::DECIMALS));
        }
        sol_log_data(&[b"open", strat.key(), maker.key(), &[kind]]);
        Ok(())
    }

    fn close(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let [maker, strat] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(maker)?;
        if !strat.is_owned_by(program_id) || strat.data_len() != STRATEGY_LEN {
            return Err(E::BadAccount.into());
        }
        {
            let s = strat.try_borrow_data()?;
            if (byte(&s, 0) != RANGE_TAG && byte(&s, 0) != BACKSTOP_TAG) || key_at(&s, strategy::MAKER) != *maker.key() {
                return Err(E::Unauthorized.into());
            }
        }
        sol_log_data(&[b"close", strat.key(), maker.key()]);
        let lamports = strat.lamports();
        *maker.try_borrow_mut_lamports()? += lamports;
        *strat.try_borrow_mut_lamports()? = 0;
        strat.close()
    }

    struct TokenAccount {
        amount: u64,
        delegate: Option<Pubkey>,
        delegated: u64,
    }

    fn token_account(a: &AccountInfo, program: &Pubkey, mint: &Pubkey, owner: Option<&Pubkey>) -> Result<TokenAccount, ProgramError> {
        if !a.is_owned_by(program) {
            return Err(E::BadAccount.into());
        }
        let d = a.try_borrow_data()?;
        if d.len() < token::LEN || key_at(&d, token::MINT) != *mint || byte(&d, token::STATE) != 1 {
            return Err(E::BadAccount.into());
        }
        if let Some(owner) = owner {
            if key_at(&d, token::OWNER) != *owner {
                return Err(E::BadAccount.into());
            }
        }
        let delegate = (u32_at(&d, token::DELEGATE_TAG) == 1).then(|| key_at(&d, token::DELEGATE));
        Ok(TokenAccount { amount: u64_at(&d, token::AMOUNT), delegate, delegated: u64_at(&d, token::DELEGATED_AMOUNT) })
    }

    fn transfer(
        program: &AccountInfo,
        from: &AccountInfo,
        mint: &AccountInfo,
        to: &AccountInfo,
        authority: &AccountInfo,
        amount: u64,
        decimals: u8,
        signers: &[Signer],
    ) -> ProgramResult {
        let a = amount.to_le_bytes();
        let data = [12, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], decimals];
        let metas = [
            AccountMeta::writable(from.key()),
            AccountMeta::readonly(mint.key()),
            AccountMeta::writable(to.key()),
            AccountMeta::readonly_signer(authority.key()),
        ];
        invoke_signed(&Instruction { program_id: program.key(), accounts: &metas, data: &data }, &[from, mint, to, authority], signers)
    }

    fn swap(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [taker, strat, oracle, delegate, mint_in, mint_out, maker_in, maker_out, taker_in, taker_out, tp_in, tp_out, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(taker)?;
        check_oracle(program_id, oracle)?;
        if !strat.is_owned_by(program_id) || strat.data_len() != STRATEGY_LEN {
            return Err(E::BadAccount.into());
        }
        let i = args::<1>(d, 0)?[0] as usize;
        let j = args::<1>(d, 1)?[0] as usize;
        let amount_in = u64::from_le_bytes(args(d, 2)?);
        let min_out = u64::from_le_bytes(args(d, 10)?);

        let (kind, n, maker, delegate_bump) = {
            let s = strat.try_borrow_data()?;
            (byte(&s, 0), byte(&s, strategy::N) as usize, key_at(&s, strategy::MAKER), byte(&s, strategy::DELEGATE_BUMP))
        };
        if kind != RANGE_TAG && kind != BACKSTOP_TAG || n > MAX_COINS {
            return Err(E::BadAccount.into());
        }
        if i == j || i >= n || j >= n {
            return Err(E::SameToken.into());
        }
        let (n, i, j) = (n % (MAX_COINS + 1), i % MAX_COINS, j % MAX_COINS);
        let (dec_in, dec_out) = {
            let s = strat.try_borrow_data()?;
            if key_at(&s, strategy::MINTS + 32 * i) != *mint_in.key() || key_at(&s, strategy::MINTS + 32 * j) != *mint_out.key() {
                return Err(E::BadAccount.into());
            }
            (byte(&s, strategy::DECIMALS + i), byte(&s, strategy::DECIMALS + j))
        };
        for (tp, mint) in [(tp_in, mint_in), (tp_out, mint_out)] {
            if (tp.key() != &TOKEN && tp.key() != &TOKEN_2022) || !mint.is_owned_by(tp.key()) {
                return Err(E::BadTokenProgram.into());
            }
        }
        let delegate_seed = [delegate_bump];
        let expected = create_program_address(&[b"delegate", &maker, &delegate_seed], program_id)?;
        if delegate.key() != &expected {
            return Err(E::BadAccount.into());
        }
        let before_in = token_account(maker_in, tp_in.key(), mint_in.key(), Some(&maker))?.amount;
        let out_acc = token_account(maker_out, tp_out.key(), mint_out.key(), Some(&maker))?;
        let spendable = if out_acc.delegate == Some(expected) { out_acc.amount.min(out_acc.delegated) } else { 0 };

        transfer(tp_in, taker_in, mint_in, maker_in, taker, amount_in, dec_in, &[])?;
        let received = token_account(maker_in, tp_in.key(), mint_in.key(), None)?.amount.checked_sub(before_in).ok_or(E::Overflow)?;

        let now = now()?;
        let o = oracle.try_borrow_data()?;
        let ctx = Ctx { oracle: &o, now };
        let out = {
            let s = strat.try_borrow_data()?;
            let mut c = Coins { n, real: [0; MAX_COINS], price: [0; MAX_COINS], unit: [1; MAX_COINS] };
            for (k, (real, unit)) in c.real.iter_mut().zip(c.unit.iter_mut()).enumerate().take(n) {
                *real = u64_at(&s, strategy::BALANCES + 8 * k);
                *unit = math::pow10(byte(&s, strategy::DECIMALS + k));
            }
            let at_in = find_entry(&o, mint_in.key()).ok_or(E::UnknownCoin)?;
            let at_out = find_entry(&o, mint_out.key()).ok_or(E::UnknownCoin)?;
            if kind == RANGE_TAG {
                if ctx.is_halted(at_in) {
                    return Err(E::Halted.into());
                }
                let mut fx = false;
                for (k, price) in c.price.iter_mut().enumerate().take(n) {
                    let at = find_entry(&o, &key_at(&s, strategy::MINTS + 32 * k)).ok_or(E::UnknownCoin)?;
                    *price = ctx.price(at)?;
                    if (k == i || k == j) && ctx.is_fx(at) {
                        fx = true;
                    }
                }
                let range = Range {
                    floor: u64_at(&s, strategy::A) as u128,
                    sum_cap_ratio: u64_at(&s, strategy::B) as u128,
                    fee_bps: if fx { u16_at(&s, strategy::P2) } else { u16_at(&s, strategy::P1) },
                    max_share_bps: u16_at(&s, strategy::P3),
                };
                math::exact_in(&c, &range, i, j, received)?
            } else {
                if ctx.is_halted(at_out) {
                    return Err(E::PayoutHalted.into());
                }
                let out = math::backstop_out(&BackstopQuote {
                    amount_in: received,
                    absorbed_in: c.real[i],
                    face_in: ctx.price(at_in)?,
                    market_in: ctx.depeg_price(at_in)?,
                    price_out: ctx.price(at_out)?,
                    unit_in: c.unit[i],
                    unit_out: c.unit[j],
                    start_bps: u16_at(&s, strategy::P1),
                    end_bps: u16_at(&s, strategy::P2),
                    cap: u64_at(&s, strategy::A),
                })?;
                if out > c.real[j] {
                    return Err(E::InsufficientReserve.into());
                }
                out
            }
        };
        drop(o);
        if out > spendable {
            return Err(E::InsufficientLiquidity.into());
        }
        if out < min_out {
            return Err(E::Slippage.into());
        }
        let seeds = [Seed::from(b"delegate"), Seed::from(&maker), Seed::from(&delegate_seed)];
        transfer(tp_out, maker_out, mint_out, taker_out, delegate, out, dec_out, &[Signer::from(&seeds)])?;

        let mut s = strat.try_borrow_mut_data()?;
        let bi = strategy::BALANCES + 8 * i;
        let bj = strategy::BALANCES + 8 * j;
        let new_i = u64_at(&s, bi).checked_add(received).ok_or(E::Overflow)?;
        let new_j = u64_at(&s, bj) - out;
        put(&mut s, bi, &new_i.to_le_bytes());
        put(&mut s, bj, &new_j.to_le_bytes());
        sol_log_data(&[
            b"swap",
            strat.key(),
            &maker,
            taker.key(),
            mint_in.key(),
            mint_out.key(),
            &received.to_le_bytes(),
            &out.to_le_bytes(),
        ]);
        Ok(())
    }

    #[cfg(feature = "devnet")]
    fn faucet(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
        let [user, mint, user_ata, authority, tp] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        signer(user)?;
        if (tp.key() != &TOKEN && tp.key() != &TOKEN_2022) || !mint.is_owned_by(tp.key()) {
            return Err(E::BadTokenProgram.into());
        }
        let amount = u64::from_le_bytes(args(d, 0)?);
        let (expected, bump) = pda(&[b"faucet"], program_id)?;
        if authority.key() != &expected {
            return Err(E::BadAccount.into());
        }
        let a = amount.to_le_bytes();
        let data = [7, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]];
        let metas = [AccountMeta::writable(mint.key()), AccountMeta::writable(user_ata.key()), AccountMeta::readonly_signer(authority.key())];
        let bump_seed = [bump];
        let seeds = [Seed::from(b"faucet"), Seed::from(&bump_seed)];
        invoke_signed(
            &Instruction { program_id: tp.key(), accounts: &metas, data: &data },
            &[mint, user_ata, authority],
            &[Signer::from(&seeds)],
        )
    }
}
