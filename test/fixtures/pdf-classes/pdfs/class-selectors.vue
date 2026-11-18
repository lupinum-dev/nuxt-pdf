<script setup lang="ts">
const props = defineProps<{ kind: 'total' | 'subtotal', size?: number }>()
const kinds = ['total']
const big = 22
const sizes = { root: '17pt' }

definePdf({ title: 'Selectors' })
</script>

<template>
  <PdfDocument>
    <PdfPage class="page">
      <PdfView class="table">
        <PdfView :class="['row', props.kind]">
          <PdfText class="cell">
            DynamicAncestor
          </PdfText>
        </PdfView>
        <PdfView
          v-for="rowKind in kinds"
          :key="rowKind"
          :class="['row', rowKind]"
        >
          <PdfView class="wrap">
            <PdfText class="cell">
              DeepDescendant
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>
      <PdfText class="cell">
        NoAncestor
      </PdfText>
      <PdfText class="row total">
        Compound
      </PdfText>
      <PdfText class="total">
        CompoundNeedsBoth
      </PdfText>
      <PdfText class="bound">
        BoundFromScript
      </PdfText>
      <PdfText class="rooted">
        BoundThroughRoot
      </PdfText>
      <PdfText class="prop-bound">
        BoundFromProp
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root { --root-size: v-bind('sizes.root') }
.page { font-size: 10pt }
.table .total .cell { font-size: 20pt }
.total .cell { font-size: 14pt }
/* Later, but fewer classes: loses to both rules above. */
.cell { font-size: 9pt }
.row.total { font-size: 16pt }
.row, .subtotal, .total, .wrap { padding: 0 }
.bound { font-size: v-bind(big) }
.rooted { font-size: var(--root-size) }
.prop-bound { font-size: v-bind('props.size') }
</style>
