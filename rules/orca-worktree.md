# worktree のルール

- worktree を操作する前に `echo $ORCA_TAB_ID` を実行し、Orca の中で動いているかを確かめる。
- 値があれば、worktree の作成・削除・一覧を `orca worktree` で行う。`git worktree` や EnterWorktree は使わない。
  - git だけで作った worktree は Orca の管理画面に出ず、agent や terminal を紐付けられないため。
- サブコマンドの使い方は覚えて書かず、実行前に `orca <command> --help` で確かめる。
  - Orca は更新が速く、オプションがバージョンごとに変わるため。
- 値が空なら通常どおり `git worktree` を使う。
