import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { ProfileSettingsView, type ProfileSettingsSection } from "./profile-settings-view"

function view(section: ProfileSettingsSection) {
  return (
    <ProfileSettingsView
      section={section}
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
    />
  )
}

describe("ProfileSettingsView", () => {
  test("renders section-specific content", () => {
    const result = render(view("general"))

    expect(screen.getByLabelText("Theme")).toBeInTheDocument()

    result.rerender(view("notifications"))
    expect(screen.getByLabelText("Sound")).toBeInTheDocument()

    result.rerender(view("appearance"))
    expect(screen.getByLabelText("Font size")).toBeInTheDocument()

    result.rerender(view("keybindings"))
    expect(screen.getByText("Command palette")).toBeInTheDocument()
    expect(screen.queryByText("Mod+N")).not.toBeInTheDocument()
  })
})
