#!/usr/bin/env node
/**
 * **確認コードのメールの送り元を journey-photo.com にする**（2026-11-24・owner「ここから送ってよい」「返信の行き先まかせる」）。
 *
 * いまの確認コードのメール（登録・再送・パスワードの再設定・メールアドレスの変更）は Cognito の既定の送り方
 * （`COGNITO_DEFAULT`）で、送り元は AWS の共用アドレス `no-reply@verificationemail.com`、**1日50通まで**
 * （AWS アカウント全体・AWS の資料「Quotas in Amazon Cognito」）。自前の送り元（Amazon SES・`DEVELOPER`）にすると
 * 上限が外れ、差出人が `journey.photo <no-reply@journey-photo.com>` になる。
 *
 * 段は3つで、**この順にしか進めない**（前の段が済んでいなければ止める）:
 *
 *   STEP=identity    ドメイン（journey-photo.com）を SES で確かめる。DKIM の CNAME 3本と DMARC（p=none）の TXT を
 *                    Route 53 に書く。**受け取る箱（no-reply）は作らない**——ドメインごと確かめれば箱の無い差出人で送れる
 *   STEP=production  SES の「本番での利用」（sandbox の解除）を申請する。**申請中は確かめた宛先にしか届かない**ので、
 *                    これが通るまで Cognito を切り替えない
 *   切り替え         Cognito のプールのメールの送り方を `DEVELOPER`（SES）にする（**別のスクリプト `ses-switch-pool.js`**。
 *                    プール ID と環境を名指しで受け取るので分けた）。差出人と返信先も設定する。
 *                    **ドメインの確認（DKIM が SUCCESS）と本番での利用が両方済んでいなければ止める**——
 *                    どちらかが欠けたまま切り替えると、登録の確認コードが届かなくなる
 *
 * どの段も **既定は読むだけ**（`--apply` で書く）。状態はいつも出す。
 *
 * 返信先は、サイトの問い合わせ先（`deploy.yml` の `contactEmail`・いまある受け取る箱）。no-reply 宛ての返信は届かないため。
 *
 * 別のセッションの「サインインの方法の知らせ」（`api-user/src/federatedNotice.ts`・#601）も同じ送り元
 * （`no-reply@journey-photo.com`）で SES から送る。そちらは `SIGNIN_EMAIL_ENABLED` が true の環境だけで、
 * **この identity 段が済むのが前提**（ドメインの確認はアカウントに1つで、両方が使う）。
 */
const {
    SESv2Client, GetEmailIdentityCommand, CreateEmailIdentityCommand, GetAccountCommand, PutAccountDetailsCommand,
} = require("@aws-sdk/client-sesv2");
const {
    Route53Client, ListHostedZonesByNameCommand, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand,
} = require("@aws-sdk/client-route-53");
const { baseUpdateParams } = require("./attach-post-confirmation");

const REGION = "ap-northeast-1";
const DOMAIN = "journey-photo.com";
const FROM_ADDRESS = `no-reply@${DOMAIN}`;
/** 差出人（`federatedNotice.ts` の `fromHeader` と同じ形） */
const FROM = `"journey.photo" <${FROM_ADDRESS}>`;
/** 返信先＝サイトの問い合わせ先（`deploy.yml` の `contactEmail` と同じ値・試験が突き合わせる） */
const REPLY_TO = "journey.photo.official@gmail.com";
/** まず見張るだけの DMARC（届け先の扱いは変えない）。結果の報告先は付けない（受け取る箱が無い） */
const DMARC_VALUE = '"v=DMARC1; p=none"';

/** DKIM の CNAME 3本（純関数・試験できる）。SES の Easy DKIM の決まった形 */
function dkimRecords(tokens, domain = DOMAIN) {
    return tokens.map((t) => ({
        Name: `${t}._domainkey.${domain}.`,
        Type: "CNAME",
        TTL: 1800,
        ResourceRecords: [{ Value: `${t}.dkim.amazonses.com` }],
    }));
}

/**
 * Route 53 に書く変更（純関数）。**既にある同じ名前の行は触らない**（DMARC を別の値で既に持っていたら上書きしない）。
 * DKIM は SES が決めた値なので、同じ名前で違う値が在れば UPSERT で直す
 */
function planRecordChanges({ tokens, existing, domain = DOMAIN }) {
    const byKey = new Map(existing.map((r) => [`${r.Name}|${r.Type}`, r]));
    const changes = [];
    for (const want of dkimRecords(tokens, domain)) {
        const have = byKey.get(`${want.Name}|CNAME`);
        if (have && JSON.stringify(have.ResourceRecords) === JSON.stringify(want.ResourceRecords)) continue;
        changes.push({ Action: "UPSERT", ResourceRecordSet: want });
    }
    const dmarcName = `_dmarc.${domain}.`;
    if (!byKey.has(`${dmarcName}|TXT`)) {
        changes.push({ Action: "CREATE", ResourceRecordSet: { Name: dmarcName, Type: "TXT", TTL: 1800, ResourceRecords: [{ Value: DMARC_VALUE }] } });
    }
    return changes;
}

/**
 * 切り替えてよいか（純関数）。**ドメインの確認と本番での利用が両方済んでいること。**
 * どちらかが欠けたまま切り替えると、登録の確認コードが届かなくなる
 */
function canSwitch({ verified, dkimStatus, productionAccess }) {
    const reasons = [];
    if (!verified || dkimStatus !== "SUCCESS") reasons.push(`ドメインの確認が済んでいない（DKIM: ${dkimStatus ?? "なし"}）`);
    if (!productionAccess) reasons.push("SES の本番での利用（sandbox の解除）が済んでいない");
    return { ok: reasons.length === 0, reasons };
}

/** プールのメールの送り方を SES にする本文（純関数）。**メールの送り方の外は1つも変えない** */
function buildEmailUpdate(userPool, identityArn) {
    const p = baseUpdateParams(userPool);
    p.EmailConfiguration = {
        EmailSendingAccount: "DEVELOPER",
        SourceArn: identityArn,
        From: FROM,
        ReplyToEmailAddress: REPLY_TO,
    };
    return p;
}

/** 本番での利用の申請の本文（SES の審査が読む・英語） */
const PRODUCTION_REQUEST = {
    MailType: "TRANSACTIONAL",
    WebsiteURL: `https://${DOMAIN}`,
    ContactLanguage: "JA",
    UseCaseDescription: [
        "journey.photo is a travel photo sharing service (web and iOS app).",
        "We send only transactional emails to our own users who signed up themselves:",
        "sign-up confirmation codes, password reset codes, email address change codes (via Amazon Cognito),",
        "and a security notice when a sign-in method (Apple / Google) is linked to an account.",
        "No marketing or bulk email. Recipients are verified by Cognito before any other email is sent.",
        "Bounces and complaints are handled with the SES account-level suppression list.",
        "Expected volume: under 200 emails per day.",
    ].join(" "),
};

async function identityStatus(ses) {
    try {
        const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: DOMAIN }));
        return {
            exists: true,
            verified: Boolean(r.VerifiedForSendingStatus),
            dkimStatus: r.DkimAttributes?.Status,
            tokens: r.DkimAttributes?.Tokens ?? [],
        };
    } catch (e) {
        if (e.name === "NotFoundException") return { exists: false, verified: false, dkimStatus: undefined, tokens: [] };
        throw e;
    }
}

async function accountStatus(ses) {
    const a = await ses.send(new GetAccountCommand({}));
    return {
        productionAccess: Boolean(a.ProductionAccessEnabled),
        review: a.Details?.ReviewDetails?.Status,
        quota: a.SendQuota,
    };
}

/** SES のドメインの ARN（アカウント ID はプールの ARN から取る・鍵の持ち主を別に問い合わせない） */
const identityArn = (accountId) => `arn:aws:ses:${REGION}:${accountId}:identity/${DOMAIN}`;

/** 状態を読んで出す（どの段も最初にこれ） */
async function readState(ses) {
    const id = await identityStatus(ses);
    const acct = await accountStatus(ses);
    console.log(`ドメイン ${DOMAIN}: ${id.exists ? `登録あり・送信の確認 ${id.verified ? "済" : "まだ"}・DKIM ${id.dkimStatus}` : "SES に未登録"}`);
    console.log(`本番での利用: ${acct.productionAccess ? "済" : `まだ（申請の状態: ${acct.review ?? "未申請"}）`}`
        + (acct.quota ? `・1日の上限 ${acct.quota.Max24HourSend} 通` : ""));
    return { id, acct };
}

async function main() {
    const step = (process.env.STEP || "status").trim();
    const apply = process.argv.includes("--apply");
    const ses = new SESv2Client({ region: REGION });

    const { id, acct } = await readState(ses);
    if (step === "status") return;

    if (step === "identity") {
        let tokens = id.tokens;
        if (!id.exists) {
            console.log(`→ SES にドメインを登録する（Easy DKIM）${apply ? "" : "（下見・--apply で実行）"}`);
            if (!apply) return;
            const r = await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: DOMAIN }));
            tokens = r.DkimAttributes?.Tokens ?? [];
        }
        const r53 = new Route53Client({ region: "us-east-1" });
        const zones = await r53.send(new ListHostedZonesByNameCommand({ DNSName: `${DOMAIN}.`, MaxItems: 1 }));
        const zone = zones.HostedZones?.find((z) => z.Name === `${DOMAIN}.` && !z.Config?.PrivateZone);
        if (!zone) throw new Error(`${DOMAIN} の公開ホストゾーンが Route 53 に無い`);
        const existing = [];
        let next = {};
        do {
            const page = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zone.Id, ...next }));
            existing.push(...(page.ResourceRecordSets ?? []));
            next = page.IsTruncated ? { StartRecordName: page.NextRecordName, StartRecordType: page.NextRecordType } : null;
        } while (next);
        const changes = planRecordChanges({ tokens, existing });
        for (const c of changes) console.log(`→ ${c.Action} ${c.ResourceRecordSet.Type} ${c.ResourceRecordSet.Name} ${c.ResourceRecordSet.ResourceRecords[0].Value}`);
        if (changes.length === 0) { console.log("Route 53 のレコードは揃っている"); return; }
        if (!apply) { console.log("（下見・--apply で書く）"); return; }
        await r53.send(new ChangeResourceRecordSetsCommand({
            HostedZoneId: zone.Id,
            ChangeBatch: { Comment: "SES の送り元の確認（DKIM）と DMARC", Changes: changes },
        }));
        console.log("書いた。DKIM の確認は数分〜72時間（SES が DNS を読みに来る）。STEP=status で見る");
        return;
    }

    if (step === "production") {
        if (acct.productionAccess) { console.log("本番での利用は済んでいる。何もしない"); return; }
        if (acct.review === "PENDING") { console.log("申請は審査中。何もしない"); return; }
        if (!id.verified) { console.log("先に STEP=identity を済ませる（ドメインの確認がまだ）"); process.exitCode = 1; return; }
        console.log(`→ 本番での利用を申請する（取引のメール・${PRODUCTION_REQUEST.UseCaseDescription.length} 字の説明）${apply ? "" : "（下見・--apply で実行）"}`);
        if (!apply) return;
        await ses.send(new PutAccountDetailsCommand({ ...PRODUCTION_REQUEST, ProductionAccessEnabled: true }));
        console.log("申請した。審査は通常 1 日ほど（AWS からメールが来る）。STEP=status で見る");
        return;
    }

    throw new Error(`STEP=${step} は知らない（status / identity / production）。プールの切り替えは scripts/ses-switch-pool.js`);
}

module.exports = { dkimRecords, planRecordChanges, canSwitch, buildEmailUpdate, readState, identityArn, FROM, FROM_ADDRESS, REPLY_TO, DOMAIN, REGION, PRODUCTION_REQUEST };

/** 権限が無いときの言い方（両方のスクリプトで同じ） */
function reportError(e) {
    if (e.name === "AccessDeniedException" || e.name === "AccessDenied") {
        console.error(`::error::権限が無い（${e.message}）。保守の鍵に SES（ses:*Identity・ses:GetAccount・ses:PutAccountDetails）・`
            + "Route 53（route53:ListHostedZonesByName・ListResourceRecordSets・ChangeResourceRecordSets）・"
            + "Cognito（cognito-idp:DescribeUserPool・UpdateUserPool）の権限が要る");
    } else {
        console.error(e);
    }
    process.exit(1);
}
module.exports.reportError = reportError;

if (require.main === module) {
    main().catch(reportError);
}
