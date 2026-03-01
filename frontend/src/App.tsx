import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';

export default function App() {
  const { connected, tasks, activeTaskId, activeEvents, createTask } = useWebSocket();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const currentTaskId = selectedTaskId || activeTaskId;
  const currentTask = tasks.find((t) => t.id === currentTaskId);

  const displayEvents = currentTaskId === activeTaskId
    ? activeEvents
    : currentTask?.events || [];

  const isRunning = currentTask?.status === 'running' ||
    (activeTaskId !== null && currentTaskId === activeTaskId);

  const handleSubmit = (prompt: string) => {
    setSelectedTaskId(null);
    createTask(prompt);
  };

  const handleSelectTask = (id: string) => {
    setSelectedTaskId(id);
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        tasks={tasks}
        activeTaskId={currentTaskId}
        onSelectTask={handleSelectTask}
        connected={connected}
      />
      <ChatArea
        events={displayEvents}
        isRunning={isRunning}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
