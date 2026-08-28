import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApp, defineComponent, h, ref } from "vue";

function ReactFixture() {
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  return createElement(
    "section",
    { "aria-labelledby": "react-heading" },
    createElement("p", { className: "eyebrow" }, "React controlled fields"),
    createElement("h2", { id: "react-heading" }, "React application fixture"),
    createElement(
      "div",
      { className: "field" },
      createElement("label", { htmlFor: "react-email" }, "Email address"),
      createElement("input", {
        id: "react-email",
        name: "email",
        type: "email",
        autoComplete: "email",
        required: true,
        value: email,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value),
      }),
    ),
    createElement(
      "div",
      { className: "field" },
      createElement("label", { htmlFor: "react-country" }, "Country"),
      createElement(
        "select",
        {
          id: "react-country",
          name: "country",
          value: country,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setCountry(event.target.value),
        },
        createElement("option", { value: "" }, "Choose"),
        createElement("option", { value: "IN" }, "India"),
        createElement("option", { value: "US" }, "United States"),
      ),
    ),
    createElement(
      "div",
      { className: "field" },
      createElement("label", { htmlFor: "react-cover" }, "Cover letter"),
      createElement("textarea", {
        id: "react-cover",
        name: "cover_letter",
        value: coverLetter,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          setCoverLetter(event.target.value),
      }),
    ),
    createElement("output", { id: "react-state" }, `React email: ${email}`),
  );
}

const VueFixture = defineComponent({
  setup() {
    const phone = ref("");
    const consent = ref(false);
    return () =>
      h("section", { "aria-labelledby": "vue-heading" }, [
        h("p", { class: "eyebrow" }, "Vue controlled fields"),
        h("h2", { id: "vue-heading" }, "Vue application fixture"),
        h("div", { class: "field" }, [
          h("label", { for: "vue-phone" }, "Mobile phone"),
          h("input", {
            id: "vue-phone",
            name: "phone_number",
            type: "tel",
            autocomplete: "tel",
            value: phone.value,
            onInput: (event: Event) => {
              phone.value = (event.target as HTMLInputElement).value;
            },
          }),
        ]),
        h("label", { class: "choice" }, [
          h("input", {
            id: "vue-consent",
            name: "privacy_consent",
            type: "checkbox",
            checked: consent.value,
            onChange: (event: Event) => {
              consent.value = (event.target as HTMLInputElement).checked;
            },
          }),
          "I agree to the privacy terms",
        ]),
        h("output", { id: "vue-state" }, `Vue phone: ${phone.value}`),
      ]);
  },
});

const reactRoot = document.getElementById("react-root");
const vueRoot = document.getElementById("vue-root");
if (!reactRoot || !vueRoot) throw new Error("Missing framework fixture roots");
createRoot(reactRoot).render(createElement(ReactFixture));
createApp(VueFixture).mount(vueRoot);
