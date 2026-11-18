# Ika program, for tests

`ika_protocol_test.so` is the Ika program built for the local development address, the one
`ika_dwallet_pinocchio::ID` names when no network feature is on. The LiteSVM tests in
`programs/issuer-ledger/tests` load it there, so the ledger's CPIs run against the real program.

It is `bin/ika_protocol_test.so` of https://github.com/dwallet-labs/ika-pre-alpha at
`668960209803670bdce574c7e4ca9e3359b235ad`, the revision `Cargo.toml` pins for
`ika-dwallet-pinocchio`. Update both together.

```
e604de2b5d40754297741e5cd82ecbb3cffc1b84f446808b15329a921e337e13  ika_protocol_test.so
```

Licensed as in `LICENSE` (BSD-3-Clause-Clear, dWallet Labs).
