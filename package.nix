{
  pkgs ? import <nixpkgs> { },
}:

pkgs.buildNpmPackage {
  pname = "conflagrate-software";
  version = "1.0.0";

  src = ./.;

  npmDepsHash = "sha256-dBmzKVrM+5R9hoTX/TQ5jUEuTEIjBft6cvzHP3K1jWg=";

  meta = {
    description = "Website for conflagrate.software";
    homepage = "https://conflagrate.software";
    license = pkgs.lib.licenses.agpl3Only;
    maintainers = [ pkgs.lib.maintainers.jakehamilton ];
  };
}
