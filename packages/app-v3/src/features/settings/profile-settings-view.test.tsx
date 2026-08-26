import { useState } from "react"
import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ProfileSettingsView, type ProfileSettingsSection } from "./profile-settings-view"

function Harness({ initial }: { initial: ProfileSettingsSection }) {
  const [section, setSection] = useState<ProfileSettingsSection>(initial)
  return (
    <ProfileSettingsView
      section={section}
      onSelectSection={setSection}
      theme="system"
      onChangeTheme={() => {}}
      density="comfortable"
      onChangeDensity={() => {}}
      fontSize="medium"
      onChangeFontSize={() => {}}
      reducedMotion={false}
      onChangeReducedMotion={() => {}}
      notifications={{ sound: true, desktop: false }}
      onChangeNotifications={() => {}}
      storage={{ usedMib: 12, budgetMib: 50 }}
      onClearCache={() => {}}
      onRemoveAllData={() => {}}
    />
  )
}

describe("ProfileSettingsView", () => {
  test("renders section-specific content and switches when navigating", async () => {
    const user = userEvent.setup()
    render(<Harness initial="general" />)

    expect(screen.getByLabelText("Theme")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Notifications" }))
    expect(screen.getByLabelText("Sound")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Appearance" }))
    expect(screen.getByLabelText("Font size")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Keybindings" }))
    expect(screen.getByText("Command palette")).toBeInTheDocument()
    expect(screen.queryByText("Mod+N")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Storage" }))
    expect(screen.getByText("Clear cached transcripts")).toBeInTheDocument()
  })
})
