import { A } from "@solidjs/router"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"

export function Header(props: { zen?: boolean; go?: boolean; hideGetStarted?: boolean }) {
  const i18n = useI18n()
  const language = useLanguage()

  const [store, setStore] = createStore({
    mobileMenuOpen: false,
  })

  return (
    <section data-component="top">
      <div>
        <A href={language.route("/")}>
          <span data-slot="logo light" style="font-size: 24px; font-weight: 700;">Hena</span>
          <span data-slot="logo dark" style="font-size: 24px; font-weight: 700;">Hena</span>
        </A>
      </div>
      <nav data-component="nav-desktop">
        <ul>
          <li>
            <a href={config.github.repoUrl} target="_blank" style="white-space: nowrap;">
              {i18n.t("nav.github")}
            </a>
          </li>
          <li>
            <a href={language.route("/docs")}>{i18n.t("nav.docs")}</a>
          </li>
          <li>
            <a href={language.route("/data")}>{i18n.t("nav.data")}</a>
          </li>
          <li>
            <A href={language.route("/zen")}>{i18n.t("nav.zen")}</A>
          </li>
          <li>
            <A href={language.route("/go")}>{i18n.t("nav.go")}</A>
          </li>
          <li>
            <A href={language.route("/enterprise")}>{i18n.t("nav.enterprise")}</A>
          </li>
          <Show when={props.zen || props.go}>
            <li>
              <a href="/auth">{i18n.t("nav.login")}</a>
            </li>
          </Show>
          <Show when={!props.hideGetStarted}>
            <li>
              <A href={language.route("/download")} data-slot="cta-button">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style="flex-shrink: 0;"
                >
                  <path
                    d="M12.1875 9.75L9.00001 12.9375L5.8125 9.75M9.00001 2.0625L9 12.375M14.4375 15.9375H3.5625"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="square"
                  />
                </svg>
                {i18n.t("nav.free")}
              </A>
            </li>
          </Show>
        </ul>
      </nav>
      <nav data-component="nav-mobile">
        <button
          type="button"
          data-component="nav-mobile-toggle"
          aria-expanded="false"
          aria-controls="nav-mobile-menu"
          class="nav-toggle"
          onClick={() => setStore("mobileMenuOpen", !store.mobileMenuOpen)}
        >
          <span class="sr-only">{i18n.t("nav.openMenu")}</span>
          <Switch>
            <Match when={store.mobileMenuOpen}>
              <svg
                class="icon icon-close"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.7071 11.9993L18.0104 17.3026L17.3033 18.0097L12 12.7064L6.6967 18.0097L5.98959 17.3026L11.2929 11.9993L5.98959 6.69595L6.6967 5.98885L12 11.2921L17.3033 5.98885L18.0104 6.69595L12.7071 11.9993Z"
                  fill="currentColor"
                />
              </svg>
            </Match>
            <Match when={!store.mobileMenuOpen}>
              <svg
                class="icon icon-hamburger"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M19 17H5V16H19V17Z" fill="currentColor" />
                <path d="M19 8H5V7H19V8Z" fill="currentColor" />
              </svg>
            </Match>
          </Switch>
        </button>

        <Show when={store.mobileMenuOpen}>
          <div id="nav-mobile-menu" data-component="nav-mobile">
            <nav data-component="nav-mobile-menu-list">
              <ul>
                <li>
                  <A href={language.route("/")}>{i18n.t("nav.home")}</A>
                </li>
                <li>
                  <a href={config.github.repoUrl} target="_blank" style="white-space: nowrap;">
                    {i18n.t("nav.github")}
                  </a>
                </li>
                <li>
                  <a href={language.route("/docs")}>{i18n.t("nav.docs")}</a>
                </li>
                <li>
                  <a href={language.route("/data")}>{i18n.t("nav.data")}</a>
                </li>
                <Show when={!props.zen}>
                  <li>
                    <A href={language.route("/zen")}>{i18n.t("nav.zen")}</A>
                  </li>
                </Show>
                <Show when={!props.go}>
                  <li>
                    <A href={language.route("/go")}>{i18n.t("nav.go")}</A>
                  </li>
                </Show>
                <li>
                  <A href={language.route("/enterprise")}>{i18n.t("nav.enterprise")}</A>
                </li>
                <Show when={props.zen || props.go}>
                  <li>
                    <a href="/auth">{i18n.t("nav.login")}</a>
                  </li>
                </Show>
                <Show when={!props.hideGetStarted}>
                  <li>
                    <A href={language.route("/download")} data-slot="cta-button">
                      {i18n.t("nav.getStartedFree")}
                    </A>
                  </li>
                </Show>
              </ul>
            </nav>
          </div>
        </Show>
      </nav>
    </section>
  )
}
