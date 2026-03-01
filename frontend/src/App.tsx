import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import Sidebar from './components/Sidebar';
import NewAgentView from './components/NewAgentView';
import TaskDetailView from './components/TaskDetailView';

export default function App() {
  const { connected, tasks, activeTaskId, activeEvents, workedDuration, createTask, followUp } = useWebSocket();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewAgent, setShowNewAgent] = useState(true);

  const currentTaskId = selectedTaskId || activeTaskId;
  const currentTask = tasks.find((t) => t.id === currentTaskId) ?? null;

  const displayEvents = currentTaskId === activeTaskId
    ? activeEvents
    : currentTask?.events || [];

  const isRunning = currentTask?.status === 'running' ||
    (activeTaskId !== null && currentTaskId === activeTaskId &&
     activeEvents.some(e => e.type !== 'status' || (e as { status?: string }).status !== 'completed'));

  const handleSubmit = (prompt: string) => {
    setShowNewAgent(false);
    setSelectedTaskId(null);
    createTask(prompt);
  };

  const handleFollowUp = (taskId: string, prompt: string) => {
    followUp(taskId, prompt);
  };

  const handleSelectTask = (id: string) => {
    setShowNewAgent(false);
    setSelectedTaskId(id);
  };

  const handleNewAgent = () => {
    setShowNewAgent(true);
    setSelectedTaskId(null);
  };

  const showDetail = !showNewAgent || activeTaskId;

  return (
    <div className="h-screen flex overflow-hidden bg-white">
      <Sidebar
        tasks={tasks}
        activeTaskId={showDetail ? currentTaskId : null}
        onSelectTask={handleSelectTask}
        onNewAgent={handleNewAgent}
        connected={connected}
      />
      {showDetail ? (
        <TaskDetailView
          task={currentTask}
          events={displayEvents}
          isRunning={isRunning}
          workedDuration={currentTaskId === activeTaskId ? workedDuration : null}
          onFollowUp={handleFollowUp}
          onNewTask={handleSubmit}
        />
      ) : (
        <NewAgentView
          tasks={tasks}
          onSubmit={handleSubmit}
          onSelectTask={handleSelectTask}
          isRunning={false}
        />
      )}
    </div>
  );
}
