{
  inputs = {
    nixpkgs.url = "github:cachix/devenv-nixpkgs/rolling";
    flake-utils.url = "github:numtide/flake-utils";
    agent-skills.url = "github:Kyure-A/agent-skills-nix";
    nur-packages.url = "github:Hol1kgmg/nur-packages";
    agent-rules.url = "github:Hol1kgmg/agent-rules-nix";
    agent-rules.inputs.nixpkgs.follows = "nixpkgs";
    agent-rules.inputs.agent-skills.follows = "agent-skills";
    nix-claude-code.url = "github:ryoppippi/nix-claude-code";
    nix-claude-code.inputs.nixpkgs.follows = "nixpkgs";

    # skill / rules の取得元。flake input にしておくと Dependabot (nix ecosystem) が
    # input ごとに更新 PR を出し、dependabot-review でレビューできる
    anthropic-skills = { url = "github:anthropics/skills"; flake = false; };
    vercel-ai = { url = "github:vercel/ai"; flake = false; };
    web-quality-skills = { url = "github:addyosmani/web-quality-skills"; flake = false; };
    yomiyasu = { url = "github:nanaism/yomiyasu"; flake = false; };
    hol1kgmg-skills = { url = "github:Hol1kgmg/skills"; flake = false; };
    security-audit-skill = { url = "github:cloudflare/security-audit-skill"; flake = false; };
    cognitive-rhythm-writing = { url = "git+https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432.git"; flake = false; };
    japanese-tech-writing = { url = "git+https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d.git"; flake = false; };
    hol1kgmg-rules = { url = "github:Hol1kgmg/rules"; flake = false; };

    # --- project inputs: 派生先が管理。adr/from-template/0005 ---
    stack-diagram = { url = "github:caru-ini/stack-diagram"; flake = false; };

  };

  outputs = inputs@{ self, nixpkgs, flake-utils, agent-skills, nur-packages, agent-rules, nix-claude-code, ... }:
    let
      agentLib = agent-skills.lib.agent-skills;
      rulesLib = agent-rules.lib.agent-rules;
      lib = nixpkgs.lib;

      templateSources = import ./sources.template.nix inputs;
      projectSources = import ./sources.nix inputs;
      allowlist = template: project: lib.subtractLists project.disable (template ++ project.enable);
      mergeSources = kind: template: project:
        let dup = builtins.attrNames (builtins.intersectAttrs template project);
        in if dup == [ ] then template // project
        else throw "sources.nix の ${kind} が sources.template.nix と重複: ${toString dup}";

      sources = mergeSources "skills" templateSources.skills projectSources.skills;
      catalog = agentLib.discoverCatalog sources;
      selection = agentLib.selectSkills {
        inherit catalog sources;
        allowlist = allowlist (import ./skills.template.nix) (import ./skills.nix);
      };

      localTargets = {
        agents = agentLib.defaultLocalTargets.agents // { enable = true; };
      };

      ruleCatalog = rulesLib.discoverCatalog (mergeSources "rules" templateSources.rules projectSources.rules);
      ruleSelection = rulesLib.selectRules {
        catalog = ruleCatalog;
        allowlist = allowlist (import ./rules.template.nix) (import ./rules.nix);
      };
      ruleTargets = {
        agents = rulesLib.defaultLocalTargets.claude // { dest = ".agents/rules"; enable = true; };
      };
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        bundle = agentLib.mkBundle { inherit pkgs selection; };
        rulesBundle = rulesLib.mkBundle { inherit pkgs; selection = ruleSelection; };
        listApp = name: ids: {
          type = "app";
          program = "${pkgs.writeShellScriptBin name ''
            cat ${pkgs.writeText "${name}-ids" (nixpkgs.lib.concatLines ids)}
          ''}/bin/${name}";
        };
      in {
        # skills / rules の宣言が解決できてバンドルが組めるかの確認（nix flake check）
        checks.skills = bundle;
        checks.rules = rulesBundle;

        apps.rules-list = listApp "rules-list" (builtins.attrNames ruleCatalog);

        apps.rules-install-local = {
          type = "app";
          program = "${rulesLib.mkLocalInstallProgram { inherit pkgs; bundle = rulesBundle; targets = ruleTargets; }}/bin/rules-install-local";
        };

        # sources から見つかった全スキル ID の一覧（skills.nix の候補）
        apps.skills-list = listApp "skills-list" (builtins.attrNames catalog);

        apps.skills-install-local = {
          type = "app";
          program = "${agentLib.mkLocalInstallProgram { inherit pkgs bundle; targets = localTargets; }}/bin/skills-install-local";
        };

        # テンプレート管理（派生先は devShells.default を編集）。adr/from-template/0005
        devShells.template = pkgs.mkShell {
          packages = [
            pkgs.just
            pkgs.jq
            pkgs.gitleaks
            pkgs.lefthook
            pkgs.gh
            pkgs.git
            pkgs.dotenvx
            nur-packages.packages.${system}.markserv
            nur-packages.packages.${system}.portless
            # gh は上で別途入れているため同梱版 default ではなく minimal
            nix-claude-code.packages.${system}.claude-minimal
            pkgs.codex
          ];

          shellHook = ''
            lefthook install >/dev/null
          '' + agentLib.mkShellHook {
            inherit pkgs bundle;
            targets = localTargets;
            quiet = true;
          } + rulesLib.mkShellHook {
            inherit pkgs;
            bundle = rulesBundle;
            targets = ruleTargets;
            quiet = true;
          };
        };

        # --- 派生先が管理。adr/from-template/0005 ---
        devShells.default = pkgs.mkShell {
          inputsFrom = [ self.devShells.${system}.template ];
          packages = [
            pkgs.nodejs_22
            pkgs.sqlite
            pkgs.cloudflared
            (pkgs.python3.withPackages (ps: [ ps.playwright ]))
          ];
          # stack-diagram の render_png.py 用。pip の playwright install の代わりに Nix のブラウザを使う
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers.override {
            withFirefox = false;
            withWebkit = false;
          };
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
      });
}
