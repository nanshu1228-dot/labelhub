#!/usr/bin/env node
/**
 * 幂等创建 doctor 深度层用的 smoke 鉴权用户(Supabase),仅输出其 uuid。
 * 绝不打印密码/service-role。env:
 *   SB_URL, SB_SERVICE_KEY, SMOKE_EMAIL, SMOKE_PASSWORD
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SB_URL
const key = process.env.SB_SERVICE_KEY
const email = process.env.SMOKE_EMAIL
const password = process.env.SMOKE_PASSWORD
if (!url || !key || !email || !password) {
  console.error('missing env (SB_URL/SB_SERVICE_KEY/SMOKE_EMAIL/SMOKE_PASSWORD)')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const created = await sb.auth.admin.createUser({ email, password, email_confirm: true })
if (created.data?.user?.id) {
  console.log(created.data.user.id)
  process.exit(0)
}
// 已存在 → 翻页找出 id;顺便把密码重置成本次 SMOKE_PASSWORD(确保能登录)
for (let p = 1; p <= 25; p++) {
  const { data } = await sb.auth.admin.listUsers({ page: p, perPage: 200 })
  const u = data?.users?.find((x) => x.email?.toLowerCase() === email.toLowerCase())
  if (u) {
    await sb.auth.admin.updateUserById(u.id, { password, email_confirm: true })
    console.log(u.id)
    process.exit(0)
  }
  if (!data?.users?.length) break
}
console.error('could not create/find user:', created.error?.message ?? 'unknown')
process.exit(1)
