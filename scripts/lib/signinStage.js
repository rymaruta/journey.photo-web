/**
 * 「Apple でサインイン」「Google でログイン」を使い始める準備の台本（札 journey.photo-ios#601・#715）が共有する、
 * 環境の取り違えの見張り。
 *
 * どの台本も Maintenance ワークフローの**ステップの env** で環境を明示して受け取る（ワークフロー全体の env は本番）。
 * staging のつもりで本番を書く（またはその逆）を「動かない」に倒すため、渡された STAGE と
 * プール名・表の名前・SSM の名前が同じ環境を指すかをここで突き合わせる。
 */

const STAGES = ["prod", "staging"];

function assertStage(stage) {
    if (!STAGES.includes(stage)) throw new Error(`STAGE は prod か staging（受け取った値: ${stage}）`);
    return stage;
}

/** その環境のプール名（`deploy-api.yml` の `cognitoPoolName` と同じ規則） */
function poolNameForStage(stage) {
    return `${assertStage(stage)}-journey-photo-client-spa`;
}

/** その環境の users 表（`deploy-api.yml` の `usersTable` と同じ規則） */
function usersTableForStage(stage) {
    return `${assertStage(stage)}-photo-gallery-users`;
}

/** 鍵の置き場（`deploy-api.yml` の `appleSigninKeyParam` と同じ規則。Lambda の役が読めるのはこの道の下だけ） */
function keyParamForStage(stage) {
    return `/journey-photo/${assertStage(stage)}/apple-signin/private-key`;
}

/** 「Apple でサインイン」のスタックのトリガーの関数（`serverless.apple-signin.yml` の `appleAuthChallenge`） */
function triggerFunctionForStage(stage) {
    return `photo-gallery-apple-signin-${assertStage(stage)}-appleAuthChallenge`;
}

/** 渡された表の名前がその環境のものか（違えば止める） */
function assertUsersTable(stage, table) {
    const want = usersTableForStage(stage);
    if (table !== want) throw new Error(`USERS_TABLE は ${want} のはず（受け取った値: ${table}）。別の環境の表を触ろうとしています`);
    return table;
}

/** 読んだプールの名前がその環境のものか（違えば止める） */
function assertPoolName(stage, poolId, name) {
    const want = poolNameForStage(stage);
    if (name !== want) throw new Error(`プール ${poolId} の名前は ${name} で、STAGE=${stage} の ${want} と合いません。別の環境のプールを触ろうとしています`);
}

module.exports = {
    STAGES, assertStage, poolNameForStage, usersTableForStage, keyParamForStage, triggerFunctionForStage,
    assertUsersTable, assertPoolName,
};
