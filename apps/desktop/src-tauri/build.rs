fn main() {
    let target = std::env::var("TARGET").unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=GTEAM_TARGET_TRIPLE={target}");
    tauri_build::build()
}
