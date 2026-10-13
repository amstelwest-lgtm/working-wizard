import { useState, type ReactNode } from "react";

/**
 * Checkbox under a password field. Unchecked until the user opts in.
 * Toggling only changes the input type; it does not move focus.
 */
export function PasswordWithShow({
  id,
  children,
}: {
  id: string;
  children: (type: "password" | "text") => ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const showId = `${id}-show`;
  return (
    <>
      {children(visible ? "text" : "password")}
      <div className="show-password">
        <input
          id={showId}
          type="checkbox"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        <label htmlFor={showId}>Show password</label>
      </div>
    </>
  );
}
