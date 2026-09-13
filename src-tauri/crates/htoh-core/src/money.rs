//! Fixed-point money.
//!
//! All amounts are stored as an integer number of **paise** (1 rupee = 100 paise).
//! This mirrors Python's `decimal.Decimal` with a fixed 2-digit scale as used by
//! the legacy HandToHand register: additions and subtractions are exact, and
//! multiplication by an integer count is exact. There is deliberately no
//! floating point anywhere in this module.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Money(i64);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("invalid amount `{0}`")]
    Invalid(String),
    #[error("amount `{0}` has more than two decimal places")]
    TooManyDecimals(String),
    #[error("amount overflow")]
    Overflow,
}

impl Money {
    pub const ZERO: Money = Money(0);

    /// Build from an integer number of paise.
    pub const fn from_paise(paise: i64) -> Money {
        Money(paise)
    }

    /// Build from whole rupees.
    pub const fn from_rupees(rupees: i64) -> Money {
        Money(rupees * 100)
    }

    pub const fn paise(self) -> i64 {
        self.0
    }

    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub fn is_negative(self) -> bool {
        self.0 < 0
    }

    pub fn abs(self) -> Money {
        Money(self.0.abs())
    }

    /// Exact multiplication by an integer quantity (e.g. note count).
    pub fn mul_int(self, qty: i64) -> Result<Money, MoneyError> {
        self.0
            .checked_mul(qty)
            .map(Money)
            .ok_or(MoneyError::Overflow)
    }

    pub fn checked_add(self, other: Money) -> Result<Money, MoneyError> {
        self.0
            .checked_add(other.0)
            .map(Money)
            .ok_or(MoneyError::Overflow)
    }

    pub fn checked_sub(self, other: Money) -> Result<Money, MoneyError> {
        self.0
            .checked_sub(other.0)
            .map(Money)
            .ok_or(MoneyError::Overflow)
    }

    /// Sum an iterator of amounts, failing on overflow.
    pub fn sum<I: IntoIterator<Item = Money>>(iter: I) -> Result<Money, MoneyError> {
        iter.into_iter()
            .try_fold(Money::ZERO, |acc, m| acc.checked_add(m))
    }

    /// Parse a decimal string such as `"1234"`, `"1234.5"`, `"-12.50"`, `"₹1,23,456.75"`.
    /// Commas, currency symbols and whitespace are ignored. More than two
    /// decimal places is an error (no silent rounding of money).
    pub fn parse(input: &str) -> Result<Money, MoneyError> {
        let cleaned: String = input
            .chars()
            .filter(|c| !c.is_whitespace() && *c != ',' && *c != '₹' && *c != '_')
            .collect();
        let cleaned = cleaned
            .strip_prefix("Rs.")
            .or_else(|| cleaned.strip_prefix("Rs"))
            .unwrap_or(&cleaned)
            .to_string();
        if cleaned.is_empty() {
            return Err(MoneyError::Invalid(input.to_string()));
        }
        let (negative, body) = match cleaned.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, cleaned.strip_prefix('+').unwrap_or(&cleaned)),
        };
        if body.is_empty() {
            return Err(MoneyError::Invalid(input.to_string()));
        }
        let (whole, frac) = match body.split_once('.') {
            Some((w, f)) => (w, f),
            None => (body, ""),
        };
        if whole.is_empty() && frac.is_empty() {
            return Err(MoneyError::Invalid(input.to_string()));
        }
        if !whole.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) {
            return Err(MoneyError::Invalid(input.to_string()));
        }
        if frac.len() > 2 {
            return Err(MoneyError::TooManyDecimals(input.to_string()));
        }
        let whole_val: i64 = if whole.is_empty() {
            0
        } else {
            whole.parse().map_err(|_| MoneyError::Overflow)?
        };
        let frac_val: i64 = match frac.len() {
            0 => 0,
            1 => frac.parse::<i64>().unwrap() * 10,
            _ => frac.parse::<i64>().unwrap(),
        };
        let paise = whole_val
            .checked_mul(100)
            .and_then(|w| w.checked_add(frac_val))
            .ok_or(MoneyError::Overflow)?;
        Ok(Money(if negative { -paise } else { paise }))
    }

    /// Plain decimal representation with exactly two decimals, e.g. `-1234.50`.
    pub fn to_plain(self) -> String {
        let sign = if self.0 < 0 { "-" } else { "" };
        let abs = self.0.unsigned_abs();
        format!("{sign}{}.{:02}", abs / 100, abs % 100)
    }

    /// Indian digit grouping (lakh / crore): `12,34,567.00`.
    pub fn to_indian(self) -> String {
        let sign = if self.0 < 0 { "-" } else { "" };
        let abs = self.0.unsigned_abs();
        let whole = (abs / 100).to_string();
        let frac = abs % 100;
        let grouped = group_indian(&whole);
        format!("{sign}{grouped}.{frac:02}")
    }

    /// Whole-rupee display used on printed registers ("without unnecessary decimals").
    pub fn to_register(self) -> String {
        if self.0 % 100 == 0 {
            let sign = if self.0 < 0 { "-" } else { "" };
            format!(
                "{sign}{}",
                group_indian(&(self.0.unsigned_abs() / 100).to_string())
            )
        } else {
            self.to_indian()
        }
    }
}

fn group_indian(whole: &str) -> String {
    if whole.len() <= 3 {
        return whole.to_string();
    }
    let (head, tail) = whole.split_at(whole.len() - 3);
    let mut groups: Vec<String> = Vec::new();
    let head_chars: Vec<char> = head.chars().collect();
    let mut i = head_chars.len();
    while i > 0 {
        let start = i.saturating_sub(2);
        groups.push(head_chars[start..i].iter().collect());
        i = start;
    }
    groups.reverse();
    format!("{},{}", groups.join(","), tail)
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_plain())
    }
}

impl Add for Money {
    type Output = Money;
    fn add(self, rhs: Money) -> Money {
        Money(self.0.checked_add(rhs.0).expect("money overflow"))
    }
}
impl Sub for Money {
    type Output = Money;
    fn sub(self, rhs: Money) -> Money {
        Money(self.0.checked_sub(rhs.0).expect("money overflow"))
    }
}
impl Neg for Money {
    type Output = Money;
    fn neg(self) -> Money {
        Money(-self.0)
    }
}
impl AddAssign for Money {
    fn add_assign(&mut self, rhs: Money) {
        *self = *self + rhs;
    }
}
impl SubAssign for Money {
    fn sub_assign(&mut self, rhs: Money) {
        *self = *self - rhs;
    }
}
impl std::iter::Sum for Money {
    fn sum<I: Iterator<Item = Money>>(iter: I) -> Money {
        iter.fold(Money::ZERO, |a, b| a + b)
    }
}

/// Serialised as an integer number of paise so JavaScript never sees a float.
impl Serialize for Money {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_i64(self.0)
    }
}
impl<'de> Deserialize<'de> for Money {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Money, D::Error> {
        let v = i64::deserialize(d)?;
        Ok(Money(v))
    }
}

impl rusqlite::types::FromSql for Money {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        i64::column_result(value).map(Money)
    }
}
impl rusqlite::types::ToSql for Money {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_fractional() {
        assert_eq!(Money::parse("1234").unwrap(), Money::from_paise(123400));
        assert_eq!(Money::parse("1234.5").unwrap(), Money::from_paise(123450));
        assert_eq!(Money::parse("1234.05").unwrap(), Money::from_paise(123405));
        assert_eq!(Money::parse(".5").unwrap(), Money::from_paise(50));
        assert_eq!(Money::parse("-12.50").unwrap(), Money::from_paise(-1250));
        assert_eq!(
            Money::parse("₹1,23,456.75").unwrap(),
            Money::from_paise(12345675)
        );
        assert_eq!(Money::parse("Rs. 100").unwrap(), Money::from_rupees(100));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(matches!(
            Money::parse("12.345"),
            Err(MoneyError::TooManyDecimals(_))
        ));
        assert!(matches!(Money::parse("abc"), Err(MoneyError::Invalid(_))));
        assert!(matches!(Money::parse(""), Err(MoneyError::Invalid(_))));
        assert!(matches!(Money::parse("1.2.3"), Err(MoneyError::Invalid(_))));
        assert!(matches!(
            Money::parse("99999999999999999999"),
            Err(MoneyError::Overflow)
        ));
    }

    #[test]
    fn arithmetic_is_exact() {
        // classic float trap: 0.1 + 0.2
        let a = Money::parse("0.10").unwrap();
        let b = Money::parse("0.20").unwrap();
        assert_eq!((a + b).to_plain(), "0.30");
        let five_hundred = Money::from_rupees(500);
        assert_eq!(five_hundred.mul_int(37).unwrap(), Money::from_rupees(18500));
        assert_eq!(
            Money::sum(vec![a, b, five_hundred]).unwrap().to_plain(),
            "500.30"
        );
    }

    #[test]
    fn formats_indian_grouping() {
        assert_eq!(Money::from_paise(12345675).to_indian(), "1,23,456.75");
        assert_eq!(Money::from_rupees(1000).to_indian(), "1,000.00");
        assert_eq!(Money::from_rupees(100).to_indian(), "100.00");
        assert_eq!(Money::from_rupees(12345678).to_indian(), "1,23,45,678.00");
        assert_eq!(Money::from_paise(-1250).to_indian(), "-12.50");
        assert_eq!(Money::from_rupees(1000).to_register(), "1,000");
        assert_eq!(Money::from_paise(100050).to_register(), "1,000.50");
    }

    #[test]
    fn serde_roundtrip_is_integer() {
        let m = Money::from_paise(123456);
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json, "123456");
        let back: Money = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }
}
