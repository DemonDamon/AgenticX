"""
AI 医疗助手演示脚本

展示如何使用 AgenticX 和深度集成的 Mem0 记忆组件
构建一个能够记忆患者信息并提供个性化建议的 AI 医疗助手。
"""

import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.llms import LiteLLMProvider
from agenticx.memory.mem0_wrapper import Mem0


class HealthcareAgent:
    """
    一个能够记忆患者上下文的 AI 医疗助手。
    """
    
    def __init__(self, llm_provider):
        """
        初始化医疗助手。

        :param llm_provider: 一个实现了 agenticx.llms.base.BaseLLM 的 LLM 提供者实例。
        """
        self.llm = llm_provider
        
        # 使用 AgenticX 的 LLM 实例来初始化我们的新 Mem0 组件
        self.memory = Mem0(llm=self.llm)
        print("✅ AI 医疗助手已初始化，并配备了由 AgenticX LLM 驱动的长期记忆。")
    
    async def initial_consultation(self, patient_info: str, patient_id: str):
        """
        进行初次问诊，记录患者的基本信息和主诉。

        :param patient_info: 患者的口述信息。
        :param patient_id: 患者的唯一标识符。
        """
        print(f"\n🩺 正在为患者 {patient_id} 进行初次问诊...")
        print(f"   患者主诉: '{patient_info}'")
        
        # 将信息存入长期记忆，这里的元数据对于区分不同患者至关重要
        await asyncio.to_thread(
            self.memory.add,
            content=patient_info,
            metadata={"user_id": patient_id, "session_type": "initial_consultation"}
        )
        print(f"   [记忆操作] 已将患者 {patient_id} 的信息存入长期记忆。")
        
        # 模拟 LLM 生成回应
        response = await self.llm.ainvoke([
            {"role": "system", "content": "You are a helpful healthcare assistant. Acknowledge the patient's statement and confirm you've noted it."},
            {"role": "user", "content": patient_info}
        ])
        
        print(f"✅ 初诊完成。")
        return response.content

    async def follow_up_question(self, question: str, patient_id: str) -> str:
        """
        回答患者的后续问题，会利用之前存储的记忆。

        :param question: 患者的后续问题。
        :param patient_id: 患者的唯一标识符。
        """
        print(f"\n❓ 患者 {patient_id} 提问: '{question}'")
        
        print(f"   [记忆操作] 正在搜索患者 {patient_id} 的相关病史...")
        # 搜索与该患者相关的记忆
        search_results = await asyncio.to_thread(
            self.memory.get,
            query=question,
            metadata={"user_id": patient_id}
        )
        
        context = "No relevant past information found."
        if search_results and search_results.get("results"):
            context = "\n".join([result["memory"] for result in search_results["results"]])
            print(f"   [记忆操作] 找到相关记忆: {context}")
        else:
            print("   [记忆操作] 未找到相关记忆。")

        # 将检索到的上下文和新问题一起发送给 LLM
        prompt = [
            {"role": "system", "content": f"You are a helpful healthcare assistant. Here is the patient's history you remember:\n---\n{context}\n---\nNow, answer the patient's new question based on their history."},
            {"role": "user", "content": question}
        ]
        
        response = await self.llm.ainvoke(prompt)
        print("✅ 已生成回答。")
        return response.content


async def main():
    """主函数，运行演示"""
    print("🚀 AI 医疗助手演示（使用 Mem0 集成）")
    print("=" * 60)
    
    # 加载 .env 文件中的环境变量
    load_dotenv()
    
    # 确保设置了 OPENAI_API_KEY 环境变量
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_API_BASE") # 获取 base_url

    if not api_key:
        print("\n❌ 错误: 请在 .env 文件中或环境中设置 OPENAI_API_KEY。")
        return

    # 1. 初始化 LLM Provider
    # 这里使用 OpenAI，但可以是任何 AgenticX 支持的 LLM
    print(f"🌍 使用 API Base URL: {base_url or '默认'}")
    llm = LiteLLMProvider(
        model="gpt-4o",
        api_key=api_key,
        base_url=base_url # 传递 base_url
    )
    
    # 2. 创建医疗助手实例
    assistant = HealthcareAgent(llm_provider=llm)
    
    patient_id = "patient_alex_456"
    
    # 3. 清空该患者之前的记忆，确保演示环境干净
    print(f"\n🧹 准备新会话，清空患者 {patient_id} 的过往记忆...")
    # 注意：在真实应用中，你可能不会随意清空记忆
    await asyncio.to_thread(assistant.memory.clear)
    
    # 4. 模拟初次问诊
    initial_info = "你好，我叫 Alex。我对青霉素过敏，而且头痛已经持续三天了。"
    response1 = await assistant.initial_consultation(initial_info, patient_id)
    print(f"\n🤖 助手回应:\n{response1}")

    # 5. 模拟后续提问
    # 这个问题依赖于助手记得患者对青霉素过敏
    follow_up_q = "我头痛得厉害，可以吃点阿莫西林吗？"
    response2 = await assistant.follow_up_question(follow_up_q, patient_id)
    print(f"\n🤖 助手回应:\n{response2}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n❌ 演示失败: {e}")
        import traceback
        traceback.print_exc() 