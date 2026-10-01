type Task = { id: string; label: string };

export function Feed({ tasks, ready }: { tasks: Task[]; ready: boolean }) @{
  var heading = "Tasks";
  const rows = tasks.map((task) => <li>{task.label}</li>);
  const keyed = tasks.map((task) => <li key={task.id}>{task.label}</li>);

  @if (ready) {
    <section>
      <h2>{heading}</h2>
      <ul>{rows}</ul>
      <ol>{keyed}</ol>
    </section>
  }
}
