//! Denomination counting and the dual-tally comparator
//! (A: system book balance from Finacle / SAP, B: physical cash in hand).

use crate::money::{Money, MoneyError};
use serde::{Deserialize, Serialize};

/// Legal-tender face values handled by the counter, in paise, highest first.
pub const NOTE_FACE_VALUES_PAISE: [i64; 6] = [50_000, 20_000, 10_000, 5_000, 2_000, 1_000];
pub const COIN_FACE_VALUES_PAISE: [i64; 3] = [500, 200, 100];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DenominationKind {
    Note,
    Coin,
    /// Loose / mixed coins entered as a single amount
    MixedCoins,
    /// Cash items (cheques, vouchers held in lieu of cash). Counted in the chest
    /// but excluded from PA-17 "cash in hand" (legacy CITEM rule).
    Citem,
}

impl DenominationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DenominationKind::Note => "note",
            DenominationKind::Coin => "coin",
            DenominationKind::MixedCoins => "mixed_coins",
            DenominationKind::Citem => "citem",
        }
    }
    pub fn parse(s: &str) -> Option<DenominationKind> {
        match s {
            "note" => Some(DenominationKind::Note),
            "coin" => Some(DenominationKind::Coin),
            "mixed_coins" => Some(DenominationKind::MixedCoins),
            "citem" => Some(DenominationKind::Citem),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DenominationLine {
    pub kind: DenominationKind,
    /// Face value in paise (0 for mixed coins / citem)
    pub face_value_paise: i64,
    /// Number of pieces (ignored for mixed coins / citem)
    pub quantity: i64,
    /// Total for mixed coins / citem lines; computed for notes and coins
    pub amount: Money,
}

impl DenominationLine {
    pub fn note(face_value_paise: i64, quantity: i64) -> Result<DenominationLine, TallyError> {
        Self::counted(DenominationKind::Note, face_value_paise, quantity)
    }
    pub fn coin(face_value_paise: i64, quantity: i64) -> Result<DenominationLine, TallyError> {
        Self::counted(DenominationKind::Coin, face_value_paise, quantity)
    }
    pub fn mixed_coins(amount: Money) -> DenominationLine {
        DenominationLine {
            kind: DenominationKind::MixedCoins,
            face_value_paise: 0,
            quantity: 0,
            amount,
        }
    }
    pub fn citem(amount: Money) -> DenominationLine {
        DenominationLine {
            kind: DenominationKind::Citem,
            face_value_paise: 0,
            quantity: 0,
            amount,
        }
    }

    fn counted(
        kind: DenominationKind,
        face_value_paise: i64,
        quantity: i64,
    ) -> Result<DenominationLine, TallyError> {
        let legal = match kind {
            DenominationKind::Note => NOTE_FACE_VALUES_PAISE.contains(&face_value_paise),
            DenominationKind::Coin => COIN_FACE_VALUES_PAISE.contains(&face_value_paise),
            _ => false,
        };
        if !legal {
            return Err(TallyError::IllegalFaceValue(face_value_paise));
        }
        if quantity < 0 {
            return Err(TallyError::NegativeQuantity);
        }
        let amount = Money::from_paise(face_value_paise).mul_int(quantity)?;
        Ok(DenominationLine {
            kind,
            face_value_paise,
            quantity,
            amount,
        })
    }

    /// Re-validate a line that arrived from the UI or the database.
    pub fn validate(&self) -> Result<(), TallyError> {
        match self.kind {
            DenominationKind::Note | DenominationKind::Coin => {
                let expected = Self::counted(self.kind, self.face_value_paise, self.quantity)?;
                if expected.amount != self.amount {
                    return Err(TallyError::LineTotalMismatch);
                }
                Ok(())
            }
            DenominationKind::MixedCoins | DenominationKind::Citem => {
                if self.amount.is_negative() {
                    return Err(TallyError::NegativeQuantity);
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TallyError {
    #[error("{0} paise is not a legal-tender face value")]
    IllegalFaceValue(i64),
    #[error("quantity must not be negative")]
    NegativeQuantity,
    #[error("line total does not equal face value x quantity")]
    LineTotalMismatch,
    #[error(transparent)]
    Money(#[from] MoneyError),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalCash {
    /// Everything in the chest, including cash items
    pub total: Money,
    /// Notes + coins + mixed coins (what PA-17 calls cash in hand)
    pub cash_in_hand: Money,
    pub citem: Money,
    pub note_count: i64,
    pub coin_count: i64,
}

/// Compute the physical cash total from a set of denomination lines.
pub fn physical_total(lines: &[DenominationLine]) -> Result<PhysicalCash, TallyError> {
    let mut total = Money::ZERO;
    let mut citem = Money::ZERO;
    let mut note_count = 0;
    let mut coin_count = 0;
    for line in lines {
        line.validate()?;
        total = total.checked_add(line.amount)?;
        match line.kind {
            DenominationKind::Note => note_count += line.quantity,
            DenominationKind::Coin => coin_count += line.quantity,
            DenominationKind::Citem => citem = citem.checked_add(line.amount)?,
            DenominationKind::MixedCoins => {}
        }
    }
    Ok(PhysicalCash {
        total,
        cash_in_hand: total.checked_sub(citem)?,
        citem,
        note_count,
        coin_count,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TallyStatus {
    Balanced,
    Surplus,
    Deficit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TallyResult {
    pub system_book_balance: Money,
    pub physical_cash: Money,
    /// physical - book. Positive = surplus (excess cash), negative = deficit (short).
    pub variance: Money,
    pub status: TallyStatus,
    /// e.g. `Balanced (₹0.00)`, `Surplus (+₹12.50)`, `Deficit (-₹300.00)`
    pub badge: String,
}

/// Dual-tally comparator: A = system book balance, B = physical cash.
pub fn compare(system_book_balance: Money, physical_cash: Money) -> TallyResult {
    let variance = physical_cash - system_book_balance;
    let status = if variance.is_zero() {
        TallyStatus::Balanced
    } else if variance.is_negative() {
        TallyStatus::Deficit
    } else {
        TallyStatus::Surplus
    };
    let badge = match status {
        TallyStatus::Balanced => "Balanced (₹0.00)".to_string(),
        TallyStatus::Surplus => format!("Surplus (+₹{})", variance.to_indian()),
        TallyStatus::Deficit => format!("Deficit (-₹{})", variance.abs().to_indian()),
    };
    TallyResult {
        system_book_balance,
        physical_cash,
        variance,
        status,
        badge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<DenominationLine> {
        vec![
            DenominationLine::note(50_000, 10).unwrap(), // 5000
            DenominationLine::note(20_000, 3).unwrap(),  // 600
            DenominationLine::note(10_000, 7).unwrap(),  // 700
            DenominationLine::note(5_000, 0).unwrap(),
            DenominationLine::note(2_000, 5).unwrap(), // 100
            DenominationLine::note(1_000, 12).unwrap(), // 120
            DenominationLine::coin(500, 4).unwrap(),   // 20
            DenominationLine::coin(200, 3).unwrap(),   // 6
            DenominationLine::coin(100, 9).unwrap(),   // 9
            DenominationLine::mixed_coins(Money::parse("13.50").unwrap()),
            DenominationLine::citem(Money::from_rupees(250)),
        ]
    }

    #[test]
    fn totals_are_exact() {
        let p = physical_total(&sample()).unwrap();
        assert_eq!(p.total.to_plain(), "6818.50");
        assert_eq!(p.citem.to_plain(), "250.00");
        assert_eq!(p.cash_in_hand.to_plain(), "6568.50");
        assert_eq!(p.note_count, 37);
        assert_eq!(p.coin_count, 16);
    }

    #[test]
    fn rejects_illegal_denominations() {
        assert_eq!(
            DenominationLine::note(200_000, 1).unwrap_err(),
            TallyError::IllegalFaceValue(200_000)
        );
        assert_eq!(
            DenominationLine::coin(1_000, 1).unwrap_err(),
            TallyError::IllegalFaceValue(1_000)
        );
        assert_eq!(
            DenominationLine::note(50_000, -1).unwrap_err(),
            TallyError::NegativeQuantity
        );
        let mut bad = DenominationLine::note(50_000, 2).unwrap();
        bad.amount = Money::from_rupees(999);
        assert_eq!(bad.validate().unwrap_err(), TallyError::LineTotalMismatch);
    }

    #[test]
    fn comparator_badges() {
        let balanced = compare(Money::from_rupees(6818), Money::from_rupees(6818));
        assert_eq!(balanced.status, TallyStatus::Balanced);
        assert_eq!(balanced.badge, "Balanced (₹0.00)");

        let surplus = compare(Money::from_rupees(6800), Money::parse("6818.50").unwrap());
        assert_eq!(surplus.status, TallyStatus::Surplus);
        assert_eq!(surplus.variance.to_plain(), "18.50");
        assert_eq!(surplus.badge, "Surplus (+₹18.50)");

        let deficit = compare(Money::from_rupees(7000), Money::from_rupees(6818));
        assert_eq!(deficit.status, TallyStatus::Deficit);
        assert_eq!(deficit.variance.to_plain(), "-182.00");
        assert_eq!(deficit.badge, "Deficit (-₹182.00)");
    }
}
