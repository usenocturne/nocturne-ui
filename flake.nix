{
  description = "Nocturne UI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      overlay = final: prev: {
        nocturne-ui = self.packages.${prev.system}.default;
      };
    in
    {
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.nocturne-ui;
        in
        {
          options.services.nocturne-ui = {
            enable = lib.mkEnableOption "Nocturne UI service";
            
            port = lib.mkOption {
              type = lib.types.port;
              default = 3500;
              description = "Port to listen on";
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Host to bind to";
            };
          };

          config = lib.mkIf cfg.enable {
            nixpkgs.overlays = [ overlay ];

            systemd.services.nocturne-ui = {
              description = "Nocturne UI Service";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              serviceConfig = {
                ExecStart = "${pkgs.nocturne-ui}/bin/nocturne";
                Restart = "always";
                Environment = [
                  "PORT=${toString cfg.port}"
                  "HOSTNAME=${cfg.host}"
                  "NEXT_TELEMETRY_DISABLED=1"
                ];
                DynamicUser = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                NoNewPrivileges = true;
                RestrictSUIDSGID = true;
                PrivateTmp = true;
                PrivateDevices = true;
                ProtectHostname = true;
                ProtectClock = true;
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectKernelLogs = true;
                ProtectControlGroups = true;
                RestrictNamespaces = true;
                LockPersonality = true;
                RestrictRealtime = true;
                SystemCallFilter = [ "@system-service" ];
                SystemCallErrorNumber = "EPERM";
              };
            };
          };
        };
    } // 
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        nodeDeps = with pkgs; [
          nodejs_20
          bun
        ];
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "nocturne-ui";
          version = "1.0.0-beta.2";
          src = ./.;

          nativeBuildInputs = nodeDeps ++ [ pkgs.cacert ];

          installPhase = ''
            runHook preInstall

            mkdir -p $out/share/nocturne/.next

            cp -r .next/standalone/. $out/share/nocturne/
            cp -r .next/static $out/share/nocturne/.next
            cp -r public $out/share/nocturne
            
            mkdir -p $out/bin
            cat > $out/bin/nocturne << EOF
            #!/bin/sh
            exec ${pkgs.nodejs_20}/bin/node $out/share/nocturne/server.js
            EOF
            chmod +x $out/bin/nocturne

            runHook postInstall
          '';

          buildPhase = ''
            runHook preBuild
            
            bun install --no-save --frozen-lockfile
            bun run build
            
            runHook postBuild
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = nodeDeps ++ (with pkgs; [
            mkcert
            openssl
          ]);

          shellHook = ''
            echo "Node $(node --version)"
            echo "bun $(bun --version)"

            if [ ! -f "cert.crt" ]; then
              echo "Setting up local SSL certificates..."
              mkcert -install
              mkcert localhost 127.0.0.1 ::1
              mv localhost+2.pem cert.crt
              mv localhost+2-key.pem cert.key
            fi
          '';
        };
      }
    );
}