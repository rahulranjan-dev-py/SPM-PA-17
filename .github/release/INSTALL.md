# HandToHand X {{TAG}} — installation and usage guide

HandToHand X is the offline-first desktop replacement for **"HandToHand V9.1 with SMR for all SO"**: a Sub Office hand-to-hand cash register, chest tally and SMR (PA-17) batch engine for India Post. It runs entirely on the office PC; no internet connection is needed after installation.

## Which file do I need?

| File | Platform | What it is | When to use it |
| --- | --- | --- | --- |
| `HandToHand.X_{{VERSION}}_x64-setup.exe` | Windows 10 / 11 (64-bit) | NSIS installer | **Recommended for every Sub Office PC.** Double-click to install. |
| `HandToHand.X_{{VERSION}}_x64_en-US.msi` | Windows 10 / 11 (64-bit) | Windows Installer package | Silent or scripted deployment by an IT team / Group Policy (`msiexec /i <file> /qn`). Same application as the `.exe`. |
| `HandToHand.X_{{VERSION}}_amd64.deb` | Debian, Ubuntu, Linux Mint | Debian package | `sudo apt install ./HandToHand.X_{{VERSION}}_amd64.deb` |
| `HandToHand.X-{{VERSION}}-1.x86_64.rpm` | Fedora, RHEL, Rocky, openSUSE | RPM package | `sudo dnf install ./HandToHand.X-{{VERSION}}-1.x86_64.rpm` (or `zypper`) |
| `HandToHand.X_{{VERSION}}_amd64.AppImage` | Any 64-bit Linux | Portable single-file app | No installation: `chmod +x` the file and run it. Good for a USB stick. |
| `HandToHand.X_{{VERSION}}_aarch64.dmg` | macOS on Apple Silicon (M1 or newer) | Disk image | Open and drag **HandToHand X** to *Applications*. |
| `HandToHand.X_{{VERSION}}_x64.dmg` | macOS on Intel | Disk image | Open and drag **HandToHand X** to *Applications*. |
| `HandToHand.X_aarch64.app.tar.gz`, `HandToHand.X_x64.app.tar.gz` | macOS | Bare app bundles | Produced for the built-in updater. Not needed for manual installation; you can ignore them. |
| `HandToHand-X-{{TAG}}-all-platforms.zip` | All | Every file above plus this guide | For divisional distribution: download once, copy to each office on a pen drive. |
| `SHA256SUMS.txt` | All | Checksums of every asset | Verify a download (`sha256sum -c SHA256SUMS.txt` on Linux/macOS, `Get-FileHash` on Windows). |

The installers are not code-signed. Windows SmartScreen and macOS Gatekeeper will warn on first launch; see the platform notes below.

## Windows 10 / 11

1. Download `HandToHand.X_{{VERSION}}_x64-setup.exe`.
2. Double-click it. If SmartScreen shows *"Windows protected your PC"*, click **More info** → **Run anyway**.
3. Follow the installer. It installs for the current user and adds a Start Menu shortcut. If the Microsoft **WebView2** runtime is missing, the installer downloads and installs it (this is the only step that needs internet).
4. Launch **HandToHand X** from the Start Menu.

IT deployment: use the `.msi` instead, e.g. `msiexec /i HandToHand.X_{{VERSION}}_x64_en-US.msi /qn`.

Data location: `%APPDATA%\in.dop.handtohandx\HandToHand.db`; automatic backups go to `%APPDATA%\in.dop.handtohandx\Automatic Backup\` unless you choose another folder (a USB drive is recommended) under *Offices & Settings → Backup & restore*.

## Linux

* Debian / Ubuntu: `sudo apt install ./HandToHand.X_{{VERSION}}_amd64.deb`
* Fedora / RHEL: `sudo dnf install ./HandToHand.X-{{VERSION}}-1.x86_64.rpm`
* Any distribution: `chmod +x HandToHand.X_{{VERSION}}_amd64.AppImage && ./HandToHand.X_{{VERSION}}_amd64.AppImage`

Data location: `~/.local/share/in.dop.handtohandx/`.

## macOS

1. Download the `.dmg` matching your Mac (Apple Silicon → `aarch64`, Intel → `x64`; check *Apple menu → About This Mac*).
2. Open the disk image and drag **HandToHand X** into *Applications*.
3. First launch: right-click the app → **Open** → **Open** (needed once because the app is unsigned).

Data location: `~/Library/Application Support/in.dop.handtohandx/`.

## First run (all platforms)

1. Sign in with username `spm` and PIN `1234`. The app immediately asks you to set a new PIN.
2. Go to **Offices & Settings → Sub Offices → Add office** and enter the office name, pincode, CSI facility ID, division, postmaster details, minimum cash reserve, maximum authorised cash limit, register start date and the opening balance on that date.
3. Under **Users & access**, create an *Operator* login for each counter PA. Only the *Supervisor / SPM* login can verify hand-overs, close the day, change settings and sign off the SMR.
4. Under **Printing**, point the slip printer at your thermal / dot-matrix printer (Windows printer name, network `host:9100`, or a port such as `LPT1`) and use **Test print**.

## Daily use

| Key | Action |
| --- | --- |
| `F3` | New voucher / article entry (Enter moves between fields; Enter on the amount saves and starts the next voucher) |
| `F2` | Cash denomination calculator (numpad-friendly) |
| `F5` | Refresh and recalculate the day's balance |
| `F9` | Tally & verification |
| `F10` | Daily closing sheet (print, PDF, dot-matrix) |
| `Esc` | Close the current panel |

* A USB barcode scanner works anywhere in the app: scan an article number (e.g. `EM123456785IN`) and the voucher form opens with the barcode filled in and the service (Speed Post / Registered / Parcel) pre-selected.
* Counter PAs add vouchers and **Submit handover**; the SPM accepts or rejects the sheet, enters the Finacle / SAP closing figure, saves the chest count and **Closes the day**. The tally badge shows *Balanced*, *Surplus* or *Deficit*.
* **SMR Hub (PA-17)**: pick the month, click **Compile all offices**, review flags (pending vouchers, cash-limit breaches), fill the stamp columns and stock, **Sign off**, then export **PA-17 PDF**, **Excel** or **CSV** per office or for the whole batch.
* **Audit Trail** lists every change with before/after values; it cannot be edited or deleted.

## Backups and moving to a new PC

* A verified backup snapshot is written every time the app closes and whenever you click **Back up now**. Keep the backup folder on a USB drive or network share.
* To move to a new PC: install HandToHand X, sign in, then *Backup & restore → Restore from file…* and select the latest `HandToHand_Backup_*.db`. A safety copy of the current data is made first.

## Building from source

Clone the repository, then `npm install` and `npm run tauri build` (requires Node 22, Rust 1.80+ and the Tauri v2 prerequisites). CI runs the Rust tests, clippy, the Windows cross-check, TypeScript typecheck, Vitest and the Vite build on every pull request.
