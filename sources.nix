# 派生先が管理。input は flake.nix の project inputs 区画に足す。adr/from-template/0005
inputs: {
  skills = {
    stack-diagram = { path = inputs.stack-diagram.outPath; subdir = "skills"; };
  };

  rules = {
  };
}
