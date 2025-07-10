from typing import Optional, Dict, Any, List, Callable, Protocol
from abc import ABC, abstractmethod
import asyncio
import uuid
from .message import Message, ProtocolMessage
from .event import AnyEvent


class MessageHandler(Protocol):
    """Protocol for message handlers."""
    
    def __call__(self, message: Message) -> Optional[Message]:
        """Handle an incoming message and optionally return a response."""
        ...


class CommunicationInterface:
    """
    Interface for agent-to-agent communication.
    This is a simple implementation that will be enhanced by M8 (Protocol Layer).
    """
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.message_handlers: Dict[str, MessageHandler] = {}
        self.message_queue: List[Message] = []
        self.sent_messages: List[Message] = []
        self.received_messages: List[Message] = []
    
    def register_message_handler(self, message_type: str, handler: MessageHandler):
        """
        Register a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Function to handle the message
        """
        self.message_handlers[message_type] = handler
    
    def send(self, recipient_id: str, content: Any, message_type: str = "default", metadata: Optional[Dict[str, Any]] = None) -> Message:
        """
        Send a message to another agent.
        
        Args:
            recipient_id: ID of the recipient agent
            content: Message content
            message_type: Type of message
            metadata: Additional metadata
            
        Returns:
            The sent message
        """
        message = Message(
            sender_id=self.agent_id,
            recipient_id=recipient_id,
            content=content,
            metadata={
                "message_type": message_type,
                **(metadata or {})
            }
        )
        
        self.sent_messages.append(message)
        
        # In a real implementation, this would route through M8 protocol layer
        # For now, we'll just store it
        return message
    
    def receive(self) -> Optional[Message]:
        """
        Receive the next message from the queue.
        
        Returns:
            Next message if available, None otherwise
        """
        if self.message_queue:
            message = self.message_queue.pop(0)
            self.received_messages.append(message)
            return message
        return None
    
    def deliver_message(self, message: Message):
        """
        Deliver a message to this agent's queue.
        This would typically be called by the protocol layer.
        
        Args:
            message: Message to deliver
        """
        self.message_queue.append(message)
    
    def process_messages(self) -> List[Message]:
        """
        Process all pending messages and return any responses.
        
        Returns:
            List of response messages
        """
        responses = []
        
        while self.message_queue:
            message = self.receive()
            if message:
                response = self._handle_message(message)
                if response:
                    responses.append(response)
        
        return responses
    
    def _handle_message(self, message: Message) -> Optional[Message]:
        """
        Handle an incoming message using registered handlers.
        
        Args:
            message: Message to handle
            
        Returns:
            Response message if handler returns one
        """
        message_type = message.metadata.get("message_type", "default")
        
        if message_type in self.message_handlers:
            handler = self.message_handlers[message_type]
            return handler(message)
        
        # Default handling - just acknowledge receipt
        return Message(
            sender_id=self.agent_id,
            recipient_id=message.sender_id,
            content={"status": "received", "original_message_id": message.id},
            metadata={"message_type": "acknowledgment"}
        )
    
    def has_pending_messages(self) -> bool:
        """Check if there are pending messages."""
        return len(self.message_queue) > 0
    
    def get_message_stats(self) -> Dict[str, Any]:
        """Get communication statistics."""
        return {
            "sent_count": len(self.sent_messages),
            "received_count": len(self.received_messages),
            "pending_count": len(self.message_queue),
            "handlers_registered": len(self.message_handlers)
        }
    
    def clear_history(self):
        """Clear message history (for testing or reset)."""
        self.sent_messages.clear()
        self.received_messages.clear()
        self.message_queue.clear()


class BroadcastCommunication(CommunicationInterface):
    """
    Extended communication interface that supports broadcasting to multiple agents.
    """
    
    def __init__(self, agent_id: str):
        super().__init__(agent_id)
        self.broadcast_groups: Dict[str, List[str]] = {}
    
    def join_group(self, group_name: str):
        """
        Join a broadcast group.
        
        Args:
            group_name: Name of the group to join
        """
        if group_name not in self.broadcast_groups:
            self.broadcast_groups[group_name] = []
        
        if self.agent_id not in self.broadcast_groups[group_name]:
            self.broadcast_groups[group_name].append(self.agent_id)
    
    def leave_group(self, group_name: str):
        """
        Leave a broadcast group.
        
        Args:
            group_name: Name of the group to leave
        """
        if group_name in self.broadcast_groups:
            if self.agent_id in self.broadcast_groups[group_name]:
                self.broadcast_groups[group_name].remove(self.agent_id)
    
    def broadcast(self, group_name: str, content: Any, message_type: str = "broadcast", metadata: Optional[Dict[str, Any]] = None) -> List[Message]:
        """
        Broadcast a message to all members of a group.
        
        Args:
            group_name: Name of the group to broadcast to
            content: Message content
            message_type: Type of message
            metadata: Additional metadata
            
        Returns:
            List of sent messages
        """
        if group_name not in self.broadcast_groups:
            return []
        
        messages = []
        for recipient_id in self.broadcast_groups[group_name]:
            if recipient_id != self.agent_id:  # Don't send to self
                message = self.send(
                    recipient_id=recipient_id,
                    content=content,
                    message_type=message_type,
                    metadata={
                        "broadcast_group": group_name,
                        **(metadata or {})
                    }
                )
                messages.append(message)
        
        return messages


class AsyncCommunicationInterface(CommunicationInterface):
    """
    Asynchronous version of the communication interface.
    """
    
    def __init__(self, agent_id: str):
        super().__init__(agent_id)
        self.async_handlers: Dict[str, Callable] = {}
    
    def register_async_handler(self, message_type: str, handler: Callable):
        """
        Register an async handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Async function to handle the message
        """
        self.async_handlers[message_type] = handler
    
    async def asend(self, recipient_id: str, content: Any, message_type: str = "default", metadata: Optional[Dict[str, Any]] = None) -> Message:
        """
        Send a message asynchronously.
        
        Args:
            recipient_id: ID of the recipient agent
            content: Message content
            message_type: Type of message
            metadata: Additional metadata
            
        Returns:
            The sent message
        """
        # For now, this is the same as sync send
        # In a real implementation, this would use async I/O
        return self.send(recipient_id, content, message_type, metadata)
    
    async def aprocess_messages(self) -> List[Message]:
        """
        Process all pending messages asynchronously.
        
        Returns:
            List of response messages
        """
        responses = []
        
        while self.message_queue:
            message = self.receive()
            if message:
                response = await self._ahandle_message(message)
                if response:
                    responses.append(response)
        
        return responses
    
    async def _ahandle_message(self, message: Message) -> Optional[Message]:
        """
        Handle an incoming message using async handlers.
        
        Args:
            message: Message to handle
            
        Returns:
            Response message if handler returns one
        """
        message_type = message.metadata.get("message_type", "default")
        
        if message_type in self.async_handlers:
            handler = self.async_handlers[message_type]
            return await handler(message)
        
        # Fall back to sync handlers
        return self._handle_message(message) 