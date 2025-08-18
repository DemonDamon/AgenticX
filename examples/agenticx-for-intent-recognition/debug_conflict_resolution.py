#!/usr/bin/env python3

from tools.post_processing_tool import PostProcessingTool

def debug_conflict_resolution():
    """调试冲突解决问题"""
    
    tool = PostProcessingTool()
    
    results = [
        {
            "intent": "search_product",
            "confidence": 0.7,
            "entities": [
                {"type": "product", "value": "手机", "confidence": 0.8},
                {"type": "product", "value": "手机", "confidence": 0.9},  # 重复实体
                {"type": "brand", "value": "苹果", "confidence": 0.85}
            ],
            "source": "llm_result"
        },
        {
            "intent": "buy_product",
            "confidence": 0.6,
            "entities": [
                {"type": "product", "value": "手机", "confidence": 0.75}
            ],
            "source": "rule_result"
        }
    ]
    
    print(f"输入结果数量: {len(results)}")
    print(f"输入结果: {results}")
    
    result = tool.execute(
        results=results,
        text="我想买苹果手机",
        context={"user_history": ["search_product"], "context_relevance": 0.8}
    )
    
    if result.error_message:
        print(f"错误: {result.error_message}")
        return
    
    data = result.result_data["data"]
    print(f"\n处理历史: {data['processing_history']}")
    print(f"\n最终结果数量: {len(data['final_results'])}")
    print(f"最终结果: {data['final_results']}")
    
    if len(data['final_results']) > 0:
        final_result = data['final_results'][0]
        print(f"\n最终结果的实体数量: {len(final_result.get('entities', []))}")
        print(f"最终结果的实体: {final_result.get('entities', [])}")

if __name__ == "__main__":
    debug_conflict_resolution()