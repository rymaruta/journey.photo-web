/**
 * AI の回数の試験（`tripAi.test.ts`）のための、手元だけで動く小さな DynamoDB の代わり。
 * `aiQuota.ts` が使う形の式（SET の足し引き・if_not_exists、条件の attribute_not_exists・比べる・AND・OR）だけを読む。
 * 条件が合わなければ本物と同じ名前の例外（ConditionalCheckFailedException）を投げる。
 */

type Item = Record<string, unknown>;
type Input = {
    Key: { id: string };
    UpdateExpression?: string;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
    ReturnValues?: string;
};

export function makeFakeDdb() {
    const items = new Map<string, Item>();
    const log: { op: "get" | "update"; input: Input }[] = [];

    function operand(tok: string, item: Item, names: Record<string, string>, values: Record<string, unknown>): unknown {
        const t = tok.trim();
        if (t.startsWith(":")) return values[t];
        if (t.startsWith("#")) return item[names[t]];
        throw new Error(`知らない式: ${t}`);
    }

    function atom(expr: string, item: Item, names: Record<string, string>, values: Record<string, unknown>): boolean {
        const e = expr.trim().replace(/^\((.*)\)$/, "$1").trim();
        if (/ OR /.test(e)) return e.split(/ OR /).some((x) => atom(x, item, names, values));
        const ne = /^attribute_not_exists\((#\w+)\)$/.exec(e);
        if (ne) return item[names[ne[1]]] === undefined;
        const cmp = /^(#\w+)\s*(<=|>=|<|>|=)\s*(:\w+)$/.exec(e);
        if (!cmp) throw new Error(`知らない条件: ${e}`);
        const a = operand(cmp[1], item, names, values) as number;
        const b = operand(cmp[3], item, names, values) as number;
        if (a === undefined) return false;
        switch (cmp[2]) {
            case "<": return a < b;
            case "<=": return a <= b;
            case ">": return a > b;
            case ">=": return a >= b;
            default: return a === b;
        }
    }

    function cond(expr: string | undefined, item: Item, names: Record<string, string>, values: Record<string, unknown>): boolean {
        if (!expr) return true;
        return expr.split(/ AND /).every((x) => atom(x, item, names, values));
    }

    function value(rhs: string, item: Item, names: Record<string, string>, values: Record<string, unknown>): unknown {
        const r = rhs.trim();
        const ine = /^if_not_exists\((#\w+),\s*(:\w+)\)\s*([+-])\s*(:\w+)$/.exec(r);
        if (ine) {
            const cur = item[names[ine[1]]];
            const base = (cur === undefined ? values[ine[2]] : cur) as number;
            const d = values[ine[4]] as number;
            return ine[3] === "+" ? base + d : base - d;
        }
        const ar = /^(#\w+)\s*([+-])\s*(:\w+)$/.exec(r);
        if (ar) {
            const base = item[names[ar[1]]] as number;
            if (base === undefined) throw Object.assign(new Error("ValidationException"), { name: "ValidationException" });
            const d = values[ar[3]] as number;
            return ar[2] === "+" ? base + d : base - d;
        }
        return operand(r, item, names, values);
    }

    async function send(cmd: { input: Input }) {
        const input = cmd.input;
        const id = input.Key.id;
        if (!input.UpdateExpression) {
            log.push({ op: "get", input });
            const it = items.get(id);
            return it ? { Item: { ...it } } : {};
        }
        log.push({ op: "update", input });
        const names = input.ExpressionAttributeNames ?? {};
        const values = input.ExpressionAttributeValues ?? {};
        const cur: Item = { ...(items.get(id) ?? {}) };
        if (!cond(input.ConditionExpression, cur, names, values)) {
            throw Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
        }
        const next: Item = { ...cur, id };
        const body = input.UpdateExpression.replace(/^SET\s+/, "");
        // 式の中の「,」は if_not_exists の引数にもあるので、括弧の外だけで分ける
        const parts: string[] = [];
        let depth = 0, last = 0;
        for (let i = 0; i < body.length; i++) {
            if (body[i] === "(") depth++;
            else if (body[i] === ")") depth--;
            else if (body[i] === "," && depth === 0) { parts.push(body.slice(last, i)); last = i + 1; }
        }
        parts.push(body.slice(last));
        for (const p of parts) {
            const [lhs, rhs] = p.split(/=(.*)/s);
            next[names[lhs.trim()]] = value(rhs, cur, names, values);
        }
        items.set(id, next);
        return input.ReturnValues === "ALL_NEW" ? { Attributes: { ...next } } : {};
    }

    return { items, log, send, reset: () => { items.clear(); log.length = 0; } };
}
