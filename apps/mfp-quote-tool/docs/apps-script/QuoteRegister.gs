/**
 * 見積書番号の台帳を、複合機見積作成ツールから読み書きするための窓口。
 *
 * 置き方は2通り。どちらでも動きます。
 *
 * 【A. 単独のスクリプトとして置く（推奨）】
 *   台帳が他の人の所有ファイルで、スクリプトをデプロイできない場合はこちら。
 *   自分のドライブに作るので、台帳側の権限に左右されません。
 *   （台帳への「編集者」権限は必要です）
 *    1. https://script.google.com を開き「新しいプロジェクト」
 *    2. 中身をすべて消して、このファイルの内容を貼り付ける
 *    3. 下の SPREADSHEET_ID に台帳のIDを入れる（URLの /d/ と /edit の間）
 *    4. 下の TOKEN を推測されにくい合言葉に書き換えて保存
 *    5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *         次のユーザーとして実行： 自分
 *         アクセスできるユーザー： 全員
 *    6. 表示された「ウェブアプリのURL」と TOKEN を、ツールの設定画面に貼り付ける
 *
 * 【B. 台帳に直接ぶら下げる】
 *   台帳が自分の所有ファイルの場合はこちらでも構いません。
 *   台帳を開いて「拡張機能」→「Apps Script」に貼り付け、
 *   SPREADSHEET_ID は空のままにして、あとは同じ手順でデプロイします。
 *
 * ※「アクセスできるユーザー：全員」でも、TOKEN が合わない要求はすべて拒否します。
 */

/** 台帳のスプレッドシートID。空のときは、このスクリプトが紐づいているシートを使う */
var SPREADSHEET_ID = "";

var TOKEN = "ここを合言葉に書き換える";

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) {
      return json({ ok: false, error: "合言葉が違います" });
    }
    var book = SPREADSHEET_ID
      ? SpreadsheetApp.openById(SPREADSHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName(req.sheetName);
    if (!sheet) {
      return json({ ok: false, error: "シートが見つかりません: " + req.sheetName });
    }

    if (req.action === "read") {
      // A〜C列（見積書番号・顧客名・内容）を返す
      var lastRow = sheet.getLastRow();
      var values = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 3).getValues() : [];
      return json({ ok: true, values: values });
    }

    if (req.action === "write") {
      return json({ ok: true, written: writeRows(sheet, req.rows || []) });
    }

    return json({ ok: false, error: "不明な操作: " + req.action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * 番号（A列）が一致する行に顧客名・内容を書き込む。
 * 番号が見つからない場合だけ、最終行の下に追記する。
 */
function writeRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  var numbers = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 1).getValues() : [];
  var rowByNumber = {};
  for (var i = 0; i < numbers.length; i++) {
    var n = String(numbers[i][0]).replace(/[^0-9]/g, "");
    if (n) rowByNumber[n] = i + 1;
  }

  var written = 0;
  var appended = [];
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var key = String(row[0]).replace(/[^0-9]/g, "");
    var target = rowByNumber[key];
    if (target) {
      sheet.getRange(target, 2, 1, 2).setValues([[row[1], row[2]]]);
      written++;
    } else {
      appended.push(row);
    }
  }
  if (appended.length) {
    sheet.getRange(lastRow + 1, 1, appended.length, 3).setValues(appended);
    written += appended.length;
  }
  return written;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
