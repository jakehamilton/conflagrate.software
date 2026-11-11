{
  description = "Website for conflagrate.software";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
  };

  outputs = { nixpkgs, ... }: {
    packages = {
      x86_64-linux = {
        default = import ./package.nix { pkgs = nixpkgs.legacyPackages.x86_64-linux; };
      };
    };
  };
}
