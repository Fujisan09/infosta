# NPO法人 情報ステーション（公開前の確認版）

このリポジトリには、書き出した公開用のページだけを置いています。
名簿の元データ・議事録・下書き・作業メモは入っていません。
理事のページ（board/）にあるのはログイン画面と画面の部品だけで、お知らせや投稿などの中身は、ログインした理事にだけ、別のサーバー（Supabase）から届きます。

- ページ：https://fujisan09.github.io/infosta/
- 理事のページ（ログイン）：https://fujisan09.github.io/infosta/board/

検索エンジンに載せない設定（noindex・robots.txt）は、公開前の確認のためのものです。中身を隠す仕組みではありません。

ページの文章やデータを直すときは、元のソース（非公開で管理）を編集してから書き出し直します。

`.github/workflows/supabase-keepalive.yml` は、理事のページ（Supabase の無料プラン）が使われない日が続いて自動で止まらないよう、1日4回データベースに「SELECT 1」だけを送る定期実行です。表は読みません。接続には権限を持たない専用のロールを使い、パスワードは GitHub の Secret にだけ置いています。

文字（Webフォント）：Zen Kaku Gothic New・Outfit（どちらも SIL Open Font License 1.1。ライセンスの文書は assets/fonts/ にあります）
理事のページの通信：supabase-js（MIT License。assets/js/vendor/supabase.js の先頭に記載）
