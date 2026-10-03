namespace sales;

entity Materials {
  key ID        : String(10);
      name      : String(60);
      category  : String(30);
      unitPrice : Decimal(9, 2);
}

entity Orders {
  key ID        : Integer;
      orderDate : Date;
      region    : String(2);
      material  : Association to Materials;
      quantity  : Integer;
      netPrice  : Decimal(11, 2);
}
