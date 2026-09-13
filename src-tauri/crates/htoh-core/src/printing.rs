//! Raw printing: ESC/POS byte builder for thermal slip printers, plain-text
//! layouts for dot-matrix / passbook printers, and RAW spooling to a network
//! printer (port 9100), a device/file path (LPT1, /dev/usb/lp0, a UNC share)
//! or, on Windows, a named printer through the spooler (`winspool`).

use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PrintTarget {
    /// TCP raw printing (JetDirect style), typically port 9100
    Network {
        host: String,
        #[serde(default = "default_port")]
        port: u16,
    },
    /// Write bytes straight to a device node, a file, `LPT1` or `\\server\share`
    Device { path: String },
    /// Windows print spooler, RAW datatype, by printer name
    WindowsSpooler { printer_name: String },
    /// Save the spool to a file (useful for previewing or for print servers that watch a folder)
    File { path: String },
}

fn default_port() -> u16 {
    9100
}

/// Minimal ESC/POS command builder.
#[derive(Default, Clone, Debug)]
pub struct EscPos {
    buf: Vec<u8>,
}

impl EscPos {
    pub fn new() -> EscPos {
        let mut e = EscPos::default();
        e.buf.extend_from_slice(&[0x1B, 0x40]); // ESC @ initialise
        e
    }
    pub fn text(mut self, s: &str) -> EscPos {
        self.buf.extend_from_slice(s.as_bytes());
        self
    }
    pub fn line(mut self, s: &str) -> EscPos {
        self.buf.extend_from_slice(s.as_bytes());
        self.buf.push(b'\n');
        self
    }
    pub fn feed(mut self, n: u8) -> EscPos {
        self.buf.extend_from_slice(&[0x1B, 0x64, n]); // ESC d n
        self
    }
    pub fn align(mut self, a: u8) -> EscPos {
        self.buf.extend_from_slice(&[0x1B, 0x61, a]); // ESC a 0/1/2
        self
    }
    pub fn bold(mut self, on: bool) -> EscPos {
        self.buf.extend_from_slice(&[0x1B, 0x45, on as u8]); // ESC E
        self
    }
    pub fn double(mut self, on: bool) -> EscPos {
        self.buf
            .extend_from_slice(&[0x1D, 0x21, if on { 0x11 } else { 0x00 }]); // GS ! n
        self
    }
    pub fn cut(mut self) -> EscPos {
        self.buf.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]); // GS V B 0 (partial cut with feed)
        self
    }
    pub fn raw(mut self, bytes: &[u8]) -> EscPos {
        self.buf.extend_from_slice(bytes);
        self
    }
    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }
}

/// Fixed-width helper for 42/80-column dot-matrix layouts.
pub fn pad_columns(left: &str, right: &str, width: usize) -> String {
    let l: String = left
        .chars()
        .take(width.saturating_sub(right.chars().count() + 1))
        .collect();
    let fill = width.saturating_sub(l.chars().count() + right.chars().count());
    format!("{l}{}{right}", " ".repeat(fill))
}

pub fn rule(width: usize) -> String {
    "-".repeat(width)
}

/// Send raw bytes to the target.
pub fn spool(target: &PrintTarget, bytes: &[u8]) -> CoreResult<usize> {
    match target {
        PrintTarget::Network { host, port } => {
            let addr = format!("{host}:{port}");
            let mut stream = std::net::TcpStream::connect_timeout(
                &addr.parse().map_err(|_| {
                    CoreError::Validation(format!("invalid printer address {addr}"))
                })?,
                std::time::Duration::from_secs(5),
            )?;
            stream.set_write_timeout(Some(std::time::Duration::from_secs(10)))?;
            stream.write_all(bytes)?;
            stream.flush()?;
            Ok(bytes.len())
        }
        PrintTarget::Device { path } | PrintTarget::File { path } => {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(matches!(target, PrintTarget::File { .. }))
                .open(path)?;
            f.write_all(bytes)?;
            f.flush()?;
            Ok(bytes.len())
        }
        PrintTarget::WindowsSpooler { printer_name } => windows_spool(printer_name, bytes),
    }
}

#[cfg(windows)]
fn windows_spool(printer_name: &str, bytes: &[u8]) -> CoreResult<usize> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
    };

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let name = wide(printer_name);
    let mut handle = PRINTER_HANDLE::default();
    unsafe {
        if OpenPrinterW(name.as_ptr(), &mut handle, std::ptr::null()) == 0 {
            return Err(CoreError::Other(format!(
                "OpenPrinter failed for `{printer_name}`"
            )));
        }
        let mut doc_name = wide("HandToHand X slip");
        let mut datatype = wide("RAW");
        let info = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: std::ptr::null_mut(),
            pDatatype: datatype.as_mut_ptr(),
        };
        if StartDocPrinterW(handle, 1, &info) == 0 {
            ClosePrinter(handle);
            return Err(CoreError::Other("StartDocPrinter failed".into()));
        }
        if StartPagePrinter(handle) == 0 {
            EndDocPrinter(handle);
            ClosePrinter(handle);
            return Err(CoreError::Other("StartPagePrinter failed".into()));
        }
        let mut written: u32 = 0;
        let ok = WritePrinter(
            handle,
            bytes.as_ptr() as *const _,
            bytes.len() as u32,
            &mut written,
        );
        EndPagePrinter(handle);
        EndDocPrinter(handle);
        ClosePrinter(handle);
        if ok == 0 {
            return Err(CoreError::Other("WritePrinter failed".into()));
        }
        Ok(written as usize)
    }
}

#[cfg(not(windows))]
fn windows_spool(printer_name: &str, _bytes: &[u8]) -> CoreResult<usize> {
    Err(CoreError::Validation(format!("Windows spooler target `{printer_name}` is only available on Windows; use a network or device target")))
}

/// Enumerate locally installed printers (Windows only; empty elsewhere).
#[cfg(windows)]
pub fn list_printers() -> CoreResult<Vec<String>> {
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };
    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;
        EnumPrintersW(
            flags,
            std::ptr::null_mut(),
            4,
            std::ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u8; needed as usize];
        if EnumPrintersW(
            flags,
            std::ptr::null_mut(),
            4,
            buf.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        ) == 0
        {
            return Err(CoreError::Other("EnumPrinters failed".into()));
        }
        let infos =
            std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, returned as usize);
        let mut names = Vec::new();
        for info in infos {
            if info.pPrinterName.is_null() {
                continue;
            }
            let mut len = 0;
            while *info.pPrinterName.add(len) != 0 {
                len += 1;
            }
            names.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                info.pPrinterName,
                len,
            )));
        }
        Ok(names)
    }
}

#[cfg(not(windows))]
pub fn list_printers() -> CoreResult<Vec<String>> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escpos_builder_emits_control_codes() {
        let bytes = EscPos::new()
            .align(1)
            .bold(true)
            .line("HANDOVER")
            .bold(false)
            .feed(2)
            .cut()
            .into_bytes();
        assert_eq!(&bytes[..2], &[0x1B, 0x40]);
        assert!(bytes.windows(3).any(|w| w == [0x1B, 0x61, 0x01]));
        assert!(bytes.windows(4).any(|w| w == [0x1D, 0x56, 0x42, 0x00]));
        assert!(String::from_utf8_lossy(&bytes).contains("HANDOVER\n"));
    }

    #[test]
    fn columns_are_padded_to_width() {
        let s = pad_columns("SB deposits", "1,234.00", 42);
        assert_eq!(s.chars().count(), 42);
        assert!(s.ends_with("1,234.00"));
        assert_eq!(rule(5), "-----");
    }

    #[test]
    fn spool_to_file_writes_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("slip.bin");
        let n = spool(
            &PrintTarget::File {
                path: path.to_string_lossy().to_string(),
            },
            b"hello",
        )
        .unwrap();
        assert_eq!(n, 5);
        assert_eq!(std::fs::read(path).unwrap(), b"hello");
    }
}
