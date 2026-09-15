# Command Code 的 Plan Quota 是月度余额，不是节奏窗

`/alpha/billing/credits` 给的 `monthlyCredits` 是剩余美元；`windowLimits` 的 5 小时 / Weekly 只约束月度池的消耗速度。本机 GOAT 账户曾出现周窗约 91% remaining、月度池只剩约 7%——若把 Weekly 当 Primary Window，Strip 会偏满。官方 CLI `/usage` 也是主条画余额、下面另开 Usage limits。

决定：Command Code 的 Primary Window 是 `monthly`。Remaining = 月度剩余 / 套餐池。池优先用官方 CLI 的套餐表，对不上或没有 `planId` 时用「剩余 + 本账期已花」。5 小时和 Weekly 仍进 Detail。加购 / 免费余额只出现在 Detail，不进主条分母。接口不给 cap、只给剩余，所以套餐表会过时；用 summary 校对，避免把节奏窗误当成池。
