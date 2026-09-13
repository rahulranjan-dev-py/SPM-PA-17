//! Barcode helpers: UPU S10 (13-character international mail item identifiers
//! such as `EM123456789IN`) plus the loose formats used on SAP/CSI slips.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BarcodeKind {
    /// Valid UPU S10 identifier with a correct check digit
    S10,
    /// Looks like S10 (2 letters + 9 digits + 2 letters) but the check digit fails
    S10BadCheckDigit,
    /// 13-digit domestic article number (e.g. Registered / Parcel domestic barcodes)
    Domestic13,
    /// Anything else (SAP document numbers, batch ids, account numbers)
    Generic,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BarcodeInfo {
    pub raw: String,
    pub normalized: String,
    pub kind: BarcodeKind,
    /// Suggested voucher type derived from the service indicator (EM -> SPEED_POST, RM/RN.. -> REGISTERED, CP -> PARCEL)
    pub suggested_voucher_type: Option<String>,
}

const S10_WEIGHTS: [u32; 8] = [8, 6, 4, 2, 3, 5, 9, 7];

/// Compute the S10 check digit for the 8 serial digits.
pub fn s10_check_digit(serial: &str) -> Option<u32> {
    if serial.len() != 8 || !serial.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let sum: u32 = serial
        .chars()
        .zip(S10_WEIGHTS.iter())
        .map(|(c, w)| c.to_digit(10).unwrap() * w)
        .sum();
    let mut check = 11 - (sum % 11);
    if check == 10 {
        check = 0;
    } else if check == 11 {
        check = 5;
    }
    Some(check)
}

pub fn classify(raw: &str) -> BarcodeInfo {
    let normalized: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    let bytes = normalized.as_bytes();
    let looks_s10 = normalized.len() == 13
        && bytes[..2].iter().all(|b| b.is_ascii_alphabetic())
        && bytes[2..11].iter().all(|b| b.is_ascii_digit())
        && bytes[11..].iter().all(|b| b.is_ascii_alphabetic());
    let kind = if looks_s10 {
        let serial = &normalized[2..10];
        let given = normalized[10..11].parse::<u32>().unwrap();
        if s10_check_digit(serial) == Some(given) {
            BarcodeKind::S10
        } else {
            BarcodeKind::S10BadCheckDigit
        }
    } else if normalized.len() == 13 && bytes.iter().all(|b| b.is_ascii_digit()) {
        BarcodeKind::Domestic13
    } else {
        BarcodeKind::Generic
    };
    let suggested_voucher_type = if looks_s10 {
        match &normalized[..2] {
            s if s.starts_with('E') => Some("SPEED_POST".to_string()),
            s if s.starts_with('R') || s.starts_with('L') || s.starts_with('V') => {
                Some("REGISTERED".to_string())
            }
            s if s.starts_with('C') => Some("PARCEL".to_string()),
            _ => None,
        }
    } else if kind == BarcodeKind::Domestic13 {
        Some("REGISTERED".to_string())
    } else {
        None
    };
    BarcodeInfo {
        raw: raw.to_string(),
        normalized,
        kind,
        suggested_voucher_type,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_digit_matches_upu_examples() {
        // RB123456785SG is the canonical UPU example
        assert_eq!(s10_check_digit("12345678"), Some(5));
        assert_eq!(classify("RB123456785SG").kind, BarcodeKind::S10);
        assert_eq!(classify("rb 123456785 sg").normalized, "RB123456785SG");
        assert_eq!(
            classify("EM123456789IN").kind,
            BarcodeKind::S10BadCheckDigit
        );
        // build a valid EM number
        let cd = s10_check_digit("12345678").unwrap();
        let id = format!("EM12345678{cd}IN");
        let info = classify(&id);
        assert_eq!(info.kind, BarcodeKind::S10);
        assert_eq!(info.suggested_voucher_type.as_deref(), Some("SPEED_POST"));
    }

    #[test]
    fn classifies_other_formats() {
        assert_eq!(classify("1234567890123").kind, BarcodeKind::Domestic13);
        assert_eq!(classify("SAP-4900012345").kind, BarcodeKind::Generic);
        assert_eq!(
            classify("CP123456785IN").suggested_voucher_type.as_deref(),
            Some("PARCEL")
        );
    }
}
