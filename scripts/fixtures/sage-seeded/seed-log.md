# Sage sandbox seed: Milon Test unit (CompanyId 18721)

Seeded Sun 11 Oct 2026, 21:52–21:56 SAST, via API (sandbox reseller host). All amounts are ZAR; VAT is 15% where it applies.

| # | Key | Entity | Endpoint | Sage ID | Doc no. | Date | Excl | VAT | Total |
|---|---|---|---|---|---|---|---|---|---|
| 1 | acct_accum_depr | Account (new, Non-Current Assets) Accumulated Depreciation | Account/Save | 664745 |  |  |  |  |  |
| 2 | bank | Bank account FNB Business Cheque | BankAccount/Save | 2655 |  |  |  |  |  |
| 3 | bank_opening | Bank opening balance (updated auto-created record)  | BankAccountOpeningBalance/Save | 6749702 |  | 2026-06-30 |  |  | 250000.0 |
| 4 | cust_c1 | Customer Karoo Logistics (Pty) Ltd | Customer/Save | 899206 |  |  |  |  |  |
| 5 | cust_c2 | Customer Fynbos Design Studio | Customer/Save | 899207 |  |  |  |  |  |
| 6 | cust_c3 | Customer Table Mountain Dental Group | Customer/Save | 899208 |  |  |  |  |  |
| 7 | sup_s1 | Supplier Cape Office Supplies CC | Supplier/Save | 213267 |  |  |  |  |  |
| 8 | sup_s2 | Supplier Bright IT Solutions (Pty) Ltd | Supplier/Save | 213268 |  |  |  |  |  |
| 9 | item | Inventory item (physical)  | Item/Save | 451729 |  |  |  |  |  |
| 10 | item_opening | Item opening balance: 10 @ R1,200 (updated auto-created record)  | ItemOpeningBalance/Save | 2045884 |  | 2026-06-30 |  |  |  |
| 11 | inv1 | Tax invoice: Karoo, paid  | TaxInvoice/Save | 6749708 | INV0000001 | 2026-07-15 | 60000.0 | 9000.0 | 69000.0 |
| 12 | inv2 | Tax invoice: Fynbos, paid  | TaxInvoice/Save | 6749709 | INV0000002 | 2026-08-12 | 45000.0 | 6750.0 | 51750.0 |
| 13 | inv3 | Tax invoice: Fynbos, UNPAID, >30 days  | TaxInvoice/Save | 6749710 | INV0000003 | 2026-08-28 | 32000.0 | 4800.0 | 36800.0 |
| 14 | inv4 | Tax invoice: Karoo, paid  | TaxInvoice/Save | 6749711 | INV0000004 | 2026-09-05 | 70000.0 | 10500.0 | 80500.0 |
| 15 | inv5 | Tax invoice: TMD, paid  | TaxInvoice/Save | 6749712 | INV0000005 | 2026-09-20 | 38000.0 | 5700.0 | 43700.0 |
| 16 | inv6 | Tax invoice: TMD, UNPAID, current (incl. 2 x sensor kit item)  | TaxInvoice/Save | 6749713 | INV0000006 | 2026-10-06 | 30000.0 | 4500.0 | 34500.0 |
| 17 | rcpt1 | Customer receipt → INV1  | CustomerReceipt/Save | 6749714 | RCP0000001 | 2026-08-10 |  |  | 69000.0 |
| 18 | rcpt2 | Customer receipt → INV2  | CustomerReceipt/Save | 6749715 | RCP0000002 | 2026-09-08 |  |  | 51750.0 |
| 19 | rcpt3 | Customer receipt → INV4  | CustomerReceipt/Save | 6749716 | RCP0000003 | 2026-09-30 |  |  | 80500.0 |
| 20 | rcpt4 | Customer receipt → INV5  | CustomerReceipt/Save | 6749717 | RCP0000004 | 2026-10-05 |  |  | 43700.0 |
| 21 | sinv1 | Supplier invoice: Cape Office (Printing & Stationery), paid  | SupplierInvoice/Save | 6749718 | SIV0000001 | 2026-08-03 | 10000.0 | 1500.0 | 11500.0 |
| 22 | sinv2 | Supplier invoice: Bright IT (Computer Expenses), UNPAID  | SupplierInvoice/Save | 6749719 | SIV0000002 | 2026-09-28 | 18000.0 | 2700.0 | 20700.0 |
| 23 | spay1 | Supplier payment → SIV1  | SupplierPayment/Save | 6749720 | PAY0000001 | 2026-08-25 |  |  | 11500.0 |
| 24 | rent_jul | Bank payment: rent (VAT 15%)  | AccountPayment/Save | 6749721 |  | 2026-07-01 | 18000.0 | 2700.0 | 20700.0 |
| 25 | rent_aug | Bank payment: rent  | AccountPayment/Save | 6749722 |  | 2026-08-01 | 18000.0 | 2700.0 | 20700.0 |
| 26 | rent_sep | Bank payment: rent  | AccountPayment/Save | 6749723 |  | 2026-09-01 | 18000.0 | 2700.0 | 20700.0 |
| 27 | rent_oct | Bank payment: rent  | AccountPayment/Save | 6749724 |  | 2026-10-01 | 18000.0 | 2700.0 | 20700.0 |
| 28 | sal_jul | Bank payment: salaries (no VAT)  | AccountPayment/Save | 6749725 |  | 2026-07-25 | 40000.0 | 0.0 | 40000.0 |
| 29 | sal_aug | Bank payment: salaries  | AccountPayment/Save | 6749726 |  | 2026-08-25 | 40000.0 | 0.0 | 40000.0 |
| 30 | sal_sep | Bank payment: salaries  | AccountPayment/Save | 6749727 |  | 2026-09-25 | 40000.0 | 0.0 | 40000.0 |
| 31 | fa_purchase | Bank payment: fixed asset, equipment (VAT capital goods)  | AccountPayment/Save | 6749728 |  | 2026-08-01 | 46000.0 | 6900.0 | 52900.0 |
| 32 | je_owner | Journal: Dr Motor Vehicles / Cr Owners Contribution (owner's capital contribution in kind)  | JournalEntry/Save | 6749729 |  | 2026-07-01 | 150000.0 | 0.0 | 150000.0 |
| 33 | je_dep_equip | Journal: Dr Depreciation / Cr Accumulated Depreciation (equipment)  | JournalEntry/Save | 6749731 |  | 2026-10-10 | 3833.33 | 0.0 | 3833.33 |
| 34 | je_dep_vehicle | Journal: Dr Depreciation / Cr Accumulated Depreciation (vehicle)  | JournalEntry/Save | 6749733 |  | 2026-10-10 | 10000.0 | 0.0 | 10000.0 |
| 35 | alloc1 | Allocation RCP1→INV1  | Allocation/Save | 1731224 |  |  |  |  | 69000.0 |
| 36 | alloc2 | Allocation RCP2→INV2  | Allocation/Save | 1731225 |  |  |  |  | 51750.0 |
| 37 | alloc3 | Allocation RCP3→INV4  | Allocation/Save | 1731226 |  |  |  |  | 80500.0 |
| 38 | alloc4 | Allocation RCP4→INV5  | Allocation/Save | 1731227 |  |  |  |  | 43700.0 |
| 39 | alloc5 | Allocation PAY1→SIV1  | Allocation/Save | 1731228 |  |  |  |  | 11500.0 |
| 40 | je_inctax | Journal: Dr Income Tax / Cr Income Tax Payable (27% provision)  | JournalEntry/Save | 6749735 |  | 2026-10-10 | 10467.0 | 0.0 | 10467.0 |

Existing accounts used: Other Sales 664738, Rent Paid 664725, Salaries & Wages 664727, Printing & Stationery 664724, Computer Expenses 664717, Depreciation 664718, Fixed Assets - Equipment 664731, Fixed Assets - Motor Vehicles 664730, Owners Contribution 664736, Income Tax 664737, Income Tax Payable 664735. Tax types: Standard Rate 154931, Standard Rate (Capital Goods) 154932, No VAT 0.

## Expected figures (Sage's own reports, FY 2026-03-01 to 2026-10-11)
Files: ProfitAndLoss.json, BalanceSheet.json (RunAtDate 2026-10-11), CustomerAgeing.json, SupplierAgeing.json (summary, ToDate 2026-10-11, ageing by invoice date)

- Revenue 275,000.00 (Other Sales 270,000 + item Sales 5,000); Cost of sales 2,400.00; Gross profit 272,600.00
- Expenses 233,833.33 (Salaries 120,000, Rent 72,000, Computer 18,000, Depreciation 13,833.33, Printing & Stationery 10,000)
- Net profit before tax 38,766.67; Income tax 10,467.00; Net profit after tax 28,299.67
- Total assets 493,216.67 = non-current 182,166.67 (Equipment 46,000 + Vehicles 150,000 − Acc dep 13,833.33) + current 311,050 (Bank 227,750, Trade receivables 71,300, Inventory 12,000)
- Liabilities 50,517.00 (Trade payables 20,700, VAT payable 19,350, Income tax payable 10,467); Equity 442,699.67 (Opening balance & VAT adj 262,000, Owners contribution 150,000, P&L this year 30,699.67)
- Debtors 71,300: Current 34,500 (INV6), 60 days 36,800 (INV3, over 30 days); Creditors 20,700: 30 days bucket (SIV2, dated 28 Sep)

## Sage quirk to know about
Sage's balance sheet keeps inventory at the opening 12,000 (8 units are on hand, worth 9,600). Its 'Profit and Loss (This Year)' is 30,699.67, which is 2,400 higher than the P&L report's 28,299.67 because the cost of sales isn't included. The two differences offset each other, so the balance sheet still balances. A sync that checks BS profit against P&L profit will be off by exactly the 2,400 cost of sales.

## Notes
- New bank accounts and items get an auto-created zero opening-balance record, so the first BankAccountOpeningBalance/Save returned 400 ('Opening balance already exists'). It was then updated by ID.
- Customer AutoAllocateToOldestInvoice did not allocate receipts, so allocations were made explicitly with Allocation/Save.
- Oct salaries weren't posted, because 25 Oct is in the future.
