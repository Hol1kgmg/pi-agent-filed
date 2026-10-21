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
  };

  outputs = inputs@{ nixpkgs, flake-utils, agent-skills, nur-packages, agent-rules, nix-claude-code, ... }:
    let
      agentLib = agent-skills.lib.agent-skills;
      rulesLib = agent-rules.lib.agent-rules;

      # 有効にする ID は ./skills.nix
      sources = {
        anthropic = { path = inputs.anthropic-skills.outPath; subdir = "skills"; };
        vercel = { path = inputs.vercel-ai.outPath; subdir = "skills"; };
        web-quality = { path = inputs.web-quality-skills.outPath; subdir = "skills"; };
        yomiyasu = { path = inputs.yomiyasu.outPath; subdir = "skills"; };
        hol1kgmg = { path = inputs.hol1kgmg-skills.outPath; subdir = "skills"; };
        security-audit = { path = inputs.security-audit-skill.outPath; subdir = "skills"; };
        # gist はルート直下に SKILL.md があり、ファイル名がそのままスキル ID になる
        cognitive-rhythm-writing = { path = inputs.cognitive-rhythm-writing.outPath; filter.maxDepth = 0; };
        japanese-tech-writing = { path = inputs.japanese-tech-writing.outPath; filter.maxDepth = 0; };
        local = { path = ./skills; };
      };
      catalog = agentLib.discoverCatalog sources;
      selection = agentLib.selectSkills {
        inherit catalog sources;
        allowlist = import ./skills.nix;
      };

      localTargets = {
        agents = agentLib.defaultLocalTargets.agents // { enable = true; };
      };

      # 有効にする ID は ./rules.nix（skills と対称）
      ruleSources = {
        hol1kgmg = { path = inputs.hol1kgmg-rules.outPath; subdir = "rules"; };
        local = { path = ./rules; };
      };
      ruleCatalog = rulesLib.discoverCatalog ruleSources;
      ruleSelection = rulesLib.selectRules {
        catalog = ruleCatalog;
        allowlist = import ./rules.nix;
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
        # skills.nix / rules.nix の宣言が解決できてバンドルが組めるかの確認（nix flake check）
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

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.just
            pkgs.gitleaks
            pkgs.lefthook
            pkgs.gh
            nur-packages.packages.${system}.markserv
            # gh は上で別途入れているため同梱版 default ではなく minimal
            nix-claude-code.packages.${system}.claude-minimal
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
      });
}
