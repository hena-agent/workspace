import { ButtonV2 } from "@hena/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@hena/ui/v2/dialog-v2"
import { DividerV2 } from "@hena/ui/v2/divider-v2"
import { Field } from "@hena/ui/v2/field-v2"
import { TextInputV2 } from "@hena/ui/v2/text-input-v2"
import { useDialog } from "@hena/ui/context/dialog"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"

export function DialogCreateProjectV2(props: { onCreate: (name: string) => Promise<boolean> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [store, setStore] = createStore({ name: "", pending: false })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const name = store.name.trim()
    if (!name || store.pending) return
    setStore("pending", true)
    void props
      .onCreate(name)
      .then((created) => {
        if (created) dialog.close()
      })
      .finally(() => setStore("pending", false))
  }

  return (
    <Dialog fit>
      <form onSubmit={submit} class="contents">
        <DialogHeader>
          <DialogTitle>{language.t("dialog.project.create.title")}</DialogTitle>
        </DialogHeader>
        <DividerV2 />
        <DialogBody class="flex w-full flex-col gap-4 px-4 py-4">
          <Field>
            <Field.Label>{language.t("dialog.project.create.name")}</Field.Label>
            <TextInputV2
              autofocus
              appearance="large"
              class="!w-full"
              value={store.name}
              placeholder={language.t("dialog.project.create.name.placeholder")}
              onInput={(event) => setStore("name", event.currentTarget.value)}
            />
          </Field>
          <p class="m-0 max-w-[420px] text-[12px] leading-5 text-v2-text-text-muted">
            {language.t("dialog.project.create.description")}
          </p>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="neutral" disabled={store.pending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast" disabled={store.pending || !store.name.trim()}>
            {store.pending ? language.t("common.loading") : language.t("dialog.project.create.submit")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
