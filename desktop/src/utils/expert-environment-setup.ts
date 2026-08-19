export type ExpertEnvironmentSetupDraftInput = {
  expertName: string;
  workspaceDir?: string;
};

/**
 * Build the editable first message for an expert-scoped environment setup chat.
 *
 * Keep application-owned Python environments separate from the expert's project
 * environment: the packaged backend and ~/.agenticx/.venv are runtime internals,
 * while project dependencies belong under the expert workspace.
 */
export function buildExpertEnvironmentSetupDraft({
  expertName,
  workspaceDir,
}: ExpertEnvironmentSetupDraftInput): string {
  const name = expertName.trim() || "当前数字专家";
  const workspace = workspaceDir?.trim() || "当前数字专家绑定的工作区";

  return [
    `请帮我为数字专家「${name}」配置工作环境。`,
    "",
    `工作区：${workspace}`,
    "",
    "请按下面的安全边界对话式完成诊断、方案确认、安装和验证：",
    "",
    "1. 先只读检查工作区里的依赖清单和锁文件，例如 requirements*.txt、pyproject.toml、uv.lock、Pipfile、environment.yml、package.json 及对应 lockfile；同时检查已启用能力能明确检测到的外部依赖。不要凭专家名称或角色猜包。",
    "2. 只承诺处理“工作区清单中声明的依赖 + 当前机器上可检测的依赖”；如果没有声明依据，请明确说明缺口，不要声称已经安装了所有隐藏依赖。",
    "3. Python 项目默认使用工作区内的 .venv。绝不能修改 Conda base，绝不能把项目依赖装进 ~/.agenticx/.venv，也不能尝试修改桌面应用的内嵌 Python/内嵌后端。",
    "4. Windows 上先运行只读诊断（优先 py -0p、where.exe python、where.exe conda），再用候选解释器的绝对路径核验 sys.executable 和 Python 版本。不要依赖当前激活的 Conda 或裸 python/pip；路径含空格时必须完整加引号。",
    "5. 选择满足项目版本约束的独立 Python 后，再创建 <工作区>/.venv；所有 pip 操作都必须使用该环境解释器的绝对路径和 -m pip。若项目明确要求 Conda，只能在工作区创建独立前缀环境，仍不得改 base。",
    "6. Node 等依赖按工作区 lockfile 选择 npm/pnpm/yarn，并优先做本地安装，不做无依据的全局安装。系统级工具无法安全自动安装时，给出明确的手动步骤。",
    "7. 在创建环境、安装或升级任何依赖之前，先展示诊断结论、拟执行命令和影响范围，并通过实际工具调用触发系统确认；没有得到确认就不要执行。不要用一句“已安装”代替真实命令结果。",
    "8. 安装完成后运行最小验证（解释器路径、版本、关键 import/命令以及项目自带测试或健康检查），最后汇报成功项、失败项、实际环境路径和可复现命令。",
    "",
    "现在先做只读诊断并给出安装方案；在我确认前不要创建环境或安装依赖。",
  ].join("\n");
}
