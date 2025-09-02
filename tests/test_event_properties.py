#!/usr/bin/env python3
"""测试事件属性访问"""

import sys
sys.path.append('.')

from agenticx.embodiment.human_in_the_loop.events import LearningDataGeneratedEvent

# 创建事件实例
event = LearningDataGeneratedEvent.create(
    trajectory_id="traj_1",
    feedback_id="feedback_1", 
    agent_id="agent_1",
    data_quality_score=0.85
)

print(f"Event created: {event}")
print(f"Event type: {type(event)}")
print(f"Event data: {event.data}")

# 测试属性访问
print(f"\nTesting property access:")
print(f"agent_id: {event.agent_id} (type: {type(event.agent_id)})")
print(f"trajectory_id: {event.trajectory_id} (type: {type(event.trajectory_id)})")
print(f"feedback_id: {event.feedback_id} (type: {type(event.feedback_id)})")
print(f"data_quality_score: {event.data_quality_score} (type: {type(event.data_quality_score)})")

# 测试断言
print(f"\nTesting assertions:")
print(f"event.agent_id == 'agent_1': {event.agent_id == 'agent_1'}")
print(f"event.trajectory_id == 'traj_1': {event.trajectory_id == 'traj_1'}")
print(f"event.feedback_id == 'feedback_1': {event.feedback_id == 'feedback_1'}")
print(f"event.data_quality_score == 0.85: {event.data_quality_score == 0.85}")