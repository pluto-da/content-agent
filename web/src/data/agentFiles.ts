/** 旧生成路径（local/generate.ts）用到的 Agent 底座文件，构建时打包。1.1.0 起平台写法不在这里：唯一真相源是 Agent 文件系统的技能 skills/<id>/SKILL.md（见 local/platformSkill.ts）。 */
import soul from '../../../agent/soul.md?raw';
import workingMethod from '../../../agent/working-method.md?raw';
import userMd from '../../../agent/USER.md?raw';

export const AGENT_FILES = { soul, workingMethod, user: userMd };
