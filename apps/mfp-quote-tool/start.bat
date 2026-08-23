@echo off
rem 複合機 見積・比較表作成ツール　起動用（Windows）
rem
rem このファイルをダブルクリックすると起動します。
rem PowerShell を使わないので、実行ポリシーやダウンロードファイルの
rem ブロックの影響を受けません。何が起きたかは start-log.txt に残ります。

setlocal enabledelayedexpansion
chcp 932 >nul 2>&1
title 複合機 見積・比較表作成ツール
cd /d "%~dp0"

set "APP=%~dp0"
set "LOG=%APP%start-log.txt"
set "MSG1="
set "MSG2="

>"%LOG%" echo ==== 複合機 見積・比較表作成ツール 起動ログ ====
>>"%LOG%" echo 日時     : %DATE% %TIME%
>>"%LOG%" echo フォルダ : %APP%

echo.
echo === 複合機 見積・比較表作成ツール ===
echo.

rem --- ZIPの中から実行していないか ---
rem エクスプローラーでZIPを開いたまま実行すると、一時フォルダに1個だけ
rem 取り出されて動くため、ほかのファイルが見つからず失敗する。
echo %APP% | find /i "\AppData\Local\Temp\" >nul
if not errorlevel 1 goto in_zip
echo %APP% | find /i ".zip\" >nul
if not errorlevel 1 goto in_zip

rem --- ファイルが揃っているか ---
if not exist "%APP%package.json" goto no_files
if not exist "%APP%src" goto no_files

rem --- Node.js があるか ---
where node >nul 2>&1
if errorlevel 1 goto no_node
set "NODEV="
for /f "tokens=*" %%V in ('node -v') do set "NODEV=%%V"
echo Node.js !NODEV! を確認しました。
>>"%LOG%" echo Node.js  : !NODEV!

rem --- データの保存先を決める ---
rem 既定は Googleドライブの共有フォルダ。変えたいときは、このフォルダに
rem data-dir.txt を置いて1行目にフォルダのパスを書く。
set "DATADIR="
if exist "%APP%data-dir.txt" goto datadir_file
if exist "G:\共有ドライブ" goto datadir_drive
set "DATADIR=%APP%data"
echo Googleドライブ ^(G:^) が見つからないため、データはこのPC内に保存します。
goto datadir_done
:datadir_file
set /p DATADIR=<"%APP%data-dir.txt"
goto datadir_done
:datadir_drive
set "DATADIR=G:\共有ドライブ\★Kevin\▲0Claude\複合機見積作成ツール\data"
:datadir_done
if not exist "!DATADIR!" mkdir "!DATADIR!"
set "MFP_DATA_DIR=!DATADIR!"
echo データの保存先: !DATADIR!
>>"%LOG%" echo 保存先   : !DATADIR!

rem --- 必要な部品の取得 ---
rem 新しい版に入れ替えると必要な部品が増えることがある。node_modules が
rem あるだけでは足りないので、package-lock.json の日付とサイズを控えておき、
rem 前回と違っていれば入れ直す。
set "LOCKSTAMP="
for %%F in ("%APP%package-lock.json") do set "LOCKSTAMP=%%~tF %%~zF"
set "STAMP=%APP%node_modules\.mfp-install-stamp"
set "PREV=__none__"
if exist "%STAMP%" set /p PREV=<"%STAMP%"
if not exist "%APP%node_modules" set "PREV=__none__"
if "!PREV!"=="!LOCKSTAMP!" goto install_done

echo.
echo 必要な部品を取得しています。数分かかります… ^(npm install^)
>>"%LOG%" echo npm install を実行します
call npm install --no-audit --no-fund
if errorlevel 1 goto npm_failed
>"%STAMP%" echo !LOCKSTAMP!
echo 部品の取得が終わりました。
:install_done

rem --- PDF出力に使う Chromium（初回のみ・失敗しても続行） ---
if exist "%APP%.chromium-installed" goto chromium_done
echo.
echo PDF出力用の部品を取得中です… ^(初回のみ^)
call npx --yes playwright install chromium
if errorlevel 1 goto chromium_skipped
>"%APP%.chromium-installed" echo ok
goto chromium_done
:chromium_skipped
echo PDF出力用の部品を取得できませんでした。Excel出力はそのまま使えます。
echo PDFが必要な場合は、帳票プレビュー画面から Ctrl+P →「PDFとして保存」をご利用ください。
>>"%LOG%" echo Chromium の取得に失敗しました
:chromium_done

rem --- AI（Claude）のAPIキー ---
rem PDF・写真の読み取りに使う。保存先の api-key.txt に置いておく。
if not exist "!DATADIR!\api-key.txt" goto nokey
set /p ANTHROPIC_API_KEY=<"!DATADIR!\api-key.txt"
echo AI読み取り用のAPIキーを読み込みました。
goto key_done
:nokey
echo AIのAPIキーが未登録です。設定画面から登録できます。
:key_done

rem --- 空いているポートを探す ---
set PORT=3100
:portloop
netstat -ano | find ":!PORT! " | find "LISTENING" >nul
if errorlevel 1 goto portfound
set /a PORT=!PORT!+1
if !PORT! lss 3110 goto portloop
:portfound
>>"%LOG%" echo ポート   : !PORT!

echo.
echo 起動しています… しばらくするとブラウザが自動で開きます。
echo 終了するときは、この黒い画面を閉じるか Ctrl + C を押してください。
echo.

rem 起動を待ってからブラウザを開く
start "" /min cmd /c "timeout /t 12 /nobreak >nul & start "" http://localhost:!PORT!/"

call npx next dev -p !PORT!
>>"%LOG%" echo next dev 終了コード: !ERRORLEVEL!
goto end

:in_zip
set "MSG1=ZIPファイルの中から実行しています。"
set "MSG2=ZIPを右クリック →「すべて展開」で展開してから、出てきたフォルダの中の start.bat を実行してください。"
goto fail

:no_files
set "MSG1=このフォルダにファイルが揃っていません。"
set "MSG2=ZIPを展開し直して、フォルダごと上書きしてください。"
goto fail

:no_node
set "MSG1=Node.js が見つかりません。"
set "MSG2=PowerShell で  winget install OpenJS.NodeJS.LTS  を実行し、PCを再起動してからもう一度お試しください。"
goto fail

:npm_failed
set "MSG1=部品の取得（npm install）に失敗しました。"
set "MSG2=社内ネットワークの制限で取得できないことがあります。この画面の内容をお送りください。"
goto fail

:fail
echo.
echo !MSG1!
echo !MSG2!
echo.
>>"%LOG%" echo エラー   : !MSG1!
>>"%LOG%" echo 対処     : !MSG2!
echo この画面の内容と、このフォルダの start-log.txt を担当者にお送りください。
echo.
pause
exit /b 1

:end
echo.
echo 終了しました。
echo エラーで終了した場合は、このフォルダの start-log.txt をお送りください。
pause
exit /b 0
